import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import { recoverOcr } from '@/lib/server/ocr-recovery'
import { inspectPublicationSources } from './publication-sources'
import { extractText as extractTextBoxesNode, probeGpuDevice as probeGpu } from '@/lib/server/ml'
import { contextualTranslation } from '../kpassword/translation'
import { getTranslationSettings } from '../kpassword/repository'
import { SectionsRepository } from '../sections/sections.repository'
import { WorksRepository, worksRepository } from './repository'
import { listSourceChapters } from './mangadex'
import { sourceBytes } from './source-http'
import { catalogMetadata } from './catalog'
import { ensureSources } from './custom-sources'
import { scheduledCheck } from './background'
import { chapterPages, discoverWorkChapters } from './chapter-sources'
import { chaptersDoneRendering, clearEmptyRenders, nextPagesToRender, nextPagesToUpgrade, renderWorkPage, upgradeWorkPage } from './render'
import { localizeNextWork } from './synopsis'
import { detectGpu } from './performance'
import { getLanguageSettings } from '../shared/language-settings'
import { workGlossary } from './names'
import { joinSplitBalloons } from './split-balloons'
import { visionReview } from './vision'
import {
  balloonColors,
  orderDetections,
  withOcrSlot,
  BATCH_PAGES,
  DOWNLOAD_TASKS,
  TRANSLATION_TASKS,
  RENDER_TASKS,
  UPGRADE_TASKS,
  applyPerformance,
} from './worker-shared'
import { WorkAutomation } from './work-automation'
import { paced } from './usage-limit'

export { WorkAutomation } from './work-automation'
export { balloonColors, orderDetections } from './worker-shared'

function processStarted(pid: number) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    return (
      stat
        .slice(stat.lastIndexOf(')') + 1)
        .trim()
        .split(/\s+/)[19] || ''
    )
  } catch {
    return ''
  }
}
export function claimAutomationLock(repository: WorksRepository, owner: string, pid = process.pid) {
  return repository.database.transaction(() => {
    const held = repository.database.prepare('SELECT * FROM automation_lock WHERE id=1').get() as
      { owner: string; pid: number; process_started: string } | undefined
    if (held?.owner === owner) return true
    if (held && held.process_started && processStarted(held.pid) === held.process_started) return false
    repository.database
      .prepare(
        'INSERT INTO automation_lock VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,pid=excluded.pid,process_started=excluded.process_started',
      )
      .run(owner, pid, processStarted(pid))
    return true
  })()
}

type ActiveTask = { workId: number; chapterId?: number; phase: 'sync' | 'download' | 'prepare'; controller: AbortController }
type WorkerState = {
  timer: ReturnType<typeof setTimeout> | null
  owner: string
  active: Map<string, ActiveTask>
  rendering: Set<number>
  renderFailed: Set<number>
  upgrading: Set<number>
  joining: Set<number>
  upgradeRetry: Map<number, number>
  synopsis: boolean
  synopsisRetryAt: number
}
const globals = globalThis as typeof globalThis & { __komaAutomation?: WorkerState }
export function pauseRunningWork(id: number) {
  for (const task of globals.__komaAutomation?.active.values() || []) if (task.workId === id) task.controller.abort()
}

export function startWorkAutomation() {
  if (process.env.KOMA_DESKTOP !== '1' || process.env.KOMA_AUTOMATION_DISABLED === '1' || globals.__komaAutomation) return
  const repository = worksRepository
  const state: WorkerState = {
    owner: crypto.randomUUID(),
    timer: null,
    active: new Map(),
    rendering: new Set(),
    renderFailed: new Set(),
    upgrading: new Set(),
    joining: new Set(),
    upgradeRetry: new Map(),
    synopsis: false,
    synopsisRetryAt: 0,
  }
  globals.__komaAutomation = state
  const engineSections = new SectionsRepository()
  const engine = new WorkAutomation({
    repository,
    sections: engineSections,
    chapters: listSourceChapters,
    pages: chapterPages,
    discover: discoverWorkChapters,
    quantum: BATCH_PAGES,
    recover: recoverOcr,
    metadata: catalogMetadata,
    inspectSources: inspectPublicationSources,
    download: (url, signal) => sourceBytes(url, true, signal),
    extract: extractTextBoxesNode,
    translate: (texts, source, target, glossary) => contextualTranslation.translate(texts, source, target, glossary),
    read: (items, source, target, glossary) => contextualTranslation.readImages(items, source, target, glossary),
    authorized: () => getTranslationSettings().enabled,
  })
  // Pedidos de "refazer leitura e desenho" de obras inteiras (OCR local de novo;
  // só os balões cujo texto mudou voltam ao tradutor).
  try {
    const request = repository.database.prepare("SELECT value FROM kv_store WHERE key='koma:reprocess-works:v1'").get() as
      { value: string } | undefined
    const ids = (request ? JSON.parse(request.value) : []).filter((id: unknown) => Number.isInteger(id)) as number[]
    if (ids.length)
      repository.database.transaction(() => {
        repository.database
          .prepare(
            `UPDATE work_pages SET upgrade_pending=1 WHERE image_id IS NOT NULL AND state IN ('ready','review')
        AND chapter_id IN (SELECT id FROM work_chapters WHERE work_id IN (${ids.map(() => '?').join(',')}))`,
          )
          .run(...ids)
        repository.database.prepare("DELETE FROM kv_store WHERE key='koma:reprocess-works:v1'").run()
        console.info('[KOMA] Obras marcadas para refazer leitura e desenho', { works: ids.length })
      })()
  } catch {
    /* Pedido inválido: ignorado. */
  }
  // O KOMA trabalha com prioridade baixa: o que o usuário estiver fazendo vem primeiro.
  try {
    os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL)
  } catch {
    /* Sem permissão: segue na prioridade atual. */
  }
  // Ao abrir, as telas vêm primeiro: o trabalho pesado (procura diária, downloads,
  // OCR, tradução e desenho) começa depois de WARMUP_MS e da detecção da placa de
  // vídeo, para os modelos carregarem uma vez só, já no dispositivo certo.
  const warmUntil = Date.now() + Number(process.env.KOMA_WARMUP_MS ?? 120000)
  let gpuChecked = false
  // Capítulos fantasma de obras sincronizadas antes desta verificação existir.
  try {
    for (const { id } of repository.database.prepare('SELECT id FROM works').all() as Array<{ id: number }>) repository.markPhantoms(id)
  } catch {
    /* Próxima sincronização da obra confere de novo. */
  }
  void detectGpu(probeGpu)
    .then(() => applyPerformance(repository.database))
    .finally(() => {
      gpuChecked = true
    })
  const tick = async () => {
    try {
      if (!claimAutomationLock(repository, state.owner)) return
      applyPerformance(repository.database)
      await ensureSources(repository.database)
      const heavy = gpuChecked && Date.now() >= warmUntil
      // Procura diária por capítulos novos, a partir do horário das Preferências.
      if (heavy) scheduledCheck(repository.database, (userId) => repository.refreshAll(userId))
      const launch = (workId: number, phase: ActiveTask['phase'], run: (signal: AbortSignal) => Promise<unknown>, chapterId?: number) => {
        const key = phase === 'sync' ? `sync:${workId}` : `${phase}:${chapterId}`
        const controller = new AbortController()
        state.active.set(key, { workId, chapterId, phase, controller })
        void run(controller.signal)
          .catch(() => {
            // Registrar só o tipo da falha; nunca conteúdo de páginas ou credenciais.
            console.error('[KOMA] Falha inesperada na fila', { workId, phase })
          })
          .finally(() => state.active.delete(key))
      }
      const sync = repository.pendingSync([...state.active.values()].map((task) => task.workId))
      if (sync) launch(sync.id, 'sync', (signal) => engine.synchronize(sync, signal))
      if (!heavy) return
      // Downloads independem do cofre e continuam durante a espera da tradução.
      while ([...state.active.values()].filter((task) => task.phase === 'download').length < DOWNLOAD_TASKS) {
        const excluded = [...state.active.values()].filter((task) => task.phase === 'sync').map((task) => task.workId)
        const busy = [...state.active.values()].flatMap((task) => (task.chapterId ? [task.chapterId] : []))
        const chapter = repository.nextDownload(excluded, busy)
        if (!chapter) break
        launch(chapter.work_id, 'download', (signal) => engine.prepare(chapter, signal, true), chapter.id)
      }
      // Capítulos em paralelo, inclusive da mesma obra; o cofre limita as chamadas.
      while ([...state.active.values()].filter((task) => task.phase === 'prepare').length < TRANSLATION_TASKS && !repository.cooldown()) {
        const busy = [...state.active.values()].flatMap((task) => (task.chapterId ? [task.chapterId] : []))
        const excluded = [...state.active.values()].filter((task) => task.phase === 'sync').map((task) => task.workId)
        const chapter = repository.nextChapter(excluded, true, busy)
        if (!chapter) break
        launch(chapter.work_id, 'prepare', (signal) => engine.prepare(chapter, signal), chapter.id)
      }
      // Atualização das páginas já traduzidas (novo OCR, traduções reaproveitadas).
      if (state.upgrading.size < UPGRADE_TASKS && !repository.cooldown() && getTranslationSettings().enabled) {
        const waiting = [...state.upgradeRetry].filter(([, until]) => until > Date.now()).map(([id]) => id)
        for (const page of nextPagesToUpgrade(
          repository.database,
          [...state.upgrading, ...waiting],
          UPGRADE_TASKS - state.upgrading.size,
        )) {
          state.upgrading.add(page.id)
          void upgradeWorkPage(
            repository.database,
            page,
            async (bytes, language) => {
              const detections = await withOcrSlot(async () =>
                orderDetections((await extractTextBoxesNode(bytes, language)).detections || [], language === 'ja'),
              )
              for (const detection of detections) Object.assign(detection, await balloonColors(bytes, detection))
              return detections
            },
            (texts, source) =>
              contextualTranslation.translate(
                texts,
                source,
                page.target_language || 'pt-br',
                workGlossary(repository.database, page.work_id),
              ),
            (imageId, detections, translations) => engineSections.replaceImageOcrItems(imageId, detections, translations),
          )
            .then(async () => {
              state.upgradeRetry.delete(page.id)
              // Última página relida do capítulo: as falas cortadas entre imagens são lidas juntas de novo.
              const pending = (
                repository.database
                  .prepare('SELECT COUNT(*) AS n FROM work_pages WHERE chapter_id=? AND upgrade_pending=1')
                  .get(page.chapter_id) as { n: number }
              ).n
              if (pending || state.joining.has(page.chapter_id)) return
              state.joining.add(page.chapter_id)
              try {
                await joinSplitBalloons(
                  repository.database,
                  page.chapter_id,
                  page.language,
                  async (bytes, language) => withOcrSlot(() => extractTextBoxesNode(bytes, language)),
                  (texts, source) =>
                    contextualTranslation.translate(
                      texts,
                      source,
                      page.target_language || 'pt-br',
                      workGlossary(repository.database, page.work_id),
                    ),
                )
                await visionReview(repository.database, page.chapter_id, page.language, (items, source) =>
                  contextualTranslation.readImages(
                    items,
                    source,
                    page.target_language || 'pt-br',
                    workGlossary(repository.database, page.work_id),
                  ),
                )
              } finally {
                state.joining.delete(page.chapter_id)
              }
            })
            .catch(() => {
              state.upgradeRetry.set(page.id, Date.now() + 10 * 60000)
              console.error('[KOMA] Falha ao atualizar página traduzida', { pageId: page.id })
            })
            .finally(() => state.upgrading.delete(page.id))
        }
      }
      // Sinopse e gêneros no idioma da interface, uma obra por vez.
      if (!state.synopsis && Date.now() >= state.synopsisRetryAt && !repository.cooldown() && getTranslationSettings().enabled) {
        state.synopsis = true
        void localizeNextWork(repository.database, getLanguageSettings(repository.database).ui, (texts, source, target) =>
          contextualTranslation.translate(texts, source, target),
        )
          .then((id) => {
            if (id === null) state.synopsisRetryAt = Date.now() + 60000
          })
          .catch(() => {
            state.synopsisRetryAt = Date.now() + 10 * 60000
            console.error('[KOMA] Falha ao traduzir a sinopse')
          })
          .finally(() => {
            state.synopsis = false
          })
      }
      // Imagens finais em PT-BR (texto original apagado e tradução desenhada).
      clearEmptyRenders(repository.database)
      if (state.rendering.size < RENDER_TASKS) {
        for (const page of nextPagesToRender(
          repository.database,
          [...state.rendering, ...state.renderFailed],
          RENDER_TASKS - state.rendering.size,
        )) {
          state.rendering.add(page.id)
          void paced('render', () => renderWorkPage(repository.database, page.id))
            .catch(() => {
              state.renderFailed.add(page.id)
              console.error('[KOMA] Falha ao gerar página traduzida', { imageId: page.id })
            })
            .finally(() => state.rendering.delete(page.id))
        }
      }
      // Capítulos cujas páginas traduzidas terminaram de ser desenhadas ficam prontos.
      for (const chapterId of chaptersDoneRendering(repository.database, [...state.renderFailed])) {
        const chapter = repository.chapter(chapterId)
        if (chapter) repository.completeChapter(chapter, [...state.renderFailed])
      }
    } catch {
      /* Persistência e próxima iteração preservam a fila; nunca registrar textos/chaves. */
    } finally {
      state.timer = setTimeout(tick, 2000)
      state.timer.unref()
    }
  }
  state.timer = setTimeout(tick, 1000)
  state.timer.unref()
  process.once('exit', () => {
    if (state.timer) clearTimeout(state.timer)
    for (const task of state.active.values()) task.controller.abort()
    ;(() => {
      try {
        repository.database.prepare('DELETE FROM automation_lock WHERE owner=?').run(state.owner)
      } catch {
        /* SQLite pode já estar fechado. */
      }
    })()
  })
}
