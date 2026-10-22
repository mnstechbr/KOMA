import fs from 'node:fs'
import os from 'node:os'
import { sameLanguage, targetInfo } from '@/lib/languages'
import type { CatalogWork } from '@/lib/works'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { recoverOcr } from '@/lib/server/ocr-recovery'
import { inspectPublicationSources } from './publication-sources'
import { configureMl, extractText as extractTextBoxesNode, probeGpuDevice as probeGpu } from '@/lib/server/ml'
import { contextualTranslation } from '../kpassword/translation'
import { getTranslationSettings } from '../kpassword/repository'
import { TranslationError } from '../kpassword/settings'
import { SectionsRepository } from '../sections/sections.repository'
import type { OcrDetection } from '../sections/sections.types'
import { WorksRepository, worksRepository, type ChapterRow, type PageRow, type WorkRow } from './repository'
import { listSourceChapters, sourcePages } from './mangadex'
import { sourceBytes, SourceError } from './source-http'
import { catalogMetadata } from './catalog'
import { ensureSources } from './custom-sources'
import { scheduledCheck } from './background'
import { recordStageTimes } from './stage-times'
import { chapterPages, discoverWorkChapters } from './chapter-sources'
import { chaptersDoneRendering, clearEmptyRenders, nextPagesToRender, nextPagesToUpgrade, renderWorkPage, upgradeWorkPage } from './render'
import { localizeNextWork } from './synopsis'
import { currentPerformance, detectGpu } from './performance'
import { getLanguageSettings } from '../shared/language-settings'
import { rememberNames, workGlossary } from './names'
import { joinSplitBalloons, splitBalloons } from './split-balloons'
import { repeatedMarks } from './watermark'
import { visionReview } from './vision'

export async function balloonColors(bytes: Buffer, detection: OcrDetection) {
  const box = detection.box!
  const image = await sharp(bytes).metadata()
  const left = Math.max(0, Math.round(box[0] + (box[2] - box[0]) * 0.14))
  const top = Math.max(0, Math.round(box[1] + (box[3] - box[1]) * 0.14))
  const width = Math.max(1, Math.min(image.width! - left, Math.round((box[2] - box[0]) * 0.72)))
  const height = Math.max(1, Math.min(image.height! - top, Math.round((box[3] - box[1]) * 0.72)))
  const sample = await sharp(bytes).extract({ left, top, width, height }).resize(24,24).removeAlpha().toColourspace('srgb').raw().toBuffer()
  const histogram = new Map<string, { count: number; rgb: number[] }>()
  for (let i=0;i<sample.length;i+=3) {
    const rgb = [sample[i],sample[i+1],sample[i+2]]
    const key = rgb.map((c) => Math.round(c/32)).join(',')
    const entry = histogram.get(key) || { count: 0, rgb: [0,0,0] }
    entry.count++; rgb.forEach((value, channel) => { entry.rgb[channel] += value }); histogram.set(key, entry)
  }
  const dominant = [...histogram.values()].sort((a,b) => b.count-a.count)[0]
  const rgb = dominant.rgb.map((value) => Math.round(value/dominant.count))
  return { background: '#'+rgb.map((value) => value.toString(16).padStart(2,'0')).join(''), foreground: rgb[0]*0.299+rgb[1]*0.587+rgb[2]*0.114 < 128 ? '#ffffff' : '#111111' }
}

interface Dependencies {
  repository: WorksRepository
  sections: Pick<SectionsRepository, 'createSectionWithImages' | 'appendImagesToSection' | 'replaceImageOcrItems' | 'markImageCompleted' | 'setSectionStatus'>
  chapters: typeof listSourceChapters
  pages: typeof sourcePages
  download: (url: string, signal: AbortSignal) => Promise<{ bytes: Buffer; mime: string }>
  quantum?: number
  recover?: typeof recoverOcr
  metadata?: typeof catalogMetadata
  inspectSources?: typeof inspectPublicationSources
  discover?: typeof discoverWorkChapters
  extract: (bytes: Buffer, language?: string) => Promise<{ detections?: OcrDetection[] }>
  translate: (texts: string[], source: string, target: string, glossary?: string) => Promise<{ translations: string[]; flagged?: number[]; skipped?: number[] }>
  /** Leitura pela IA dos recortes de fala que o OCR leu mal (só provedores com imagem). */
  read?: (items: Array<{ png: Buffer; ocr: string }>, source: string, target: string, glossary?: string) => Promise<Array<{ source: string; text: string; skip: boolean }> | null>
  authorized: () => boolean
}

export function orderDetections(detections: OcrDetection[], rightToLeft: boolean) {
  return detections.filter((d) => d.box?.length === 4).sort((a, b) => {
    const aa = a.box!; const bb = b.box!
    const tolerance = Math.min(aa[3] - aa[1], bb[3] - bb[1]) * 0.4
    return Math.abs(aa[1] - bb[1]) > tolerance ? aa[1] - bb[1] : (rightToLeft ? bb[0] - aa[0] : aa[0] - bb[0])
  })
}

// OCR local é intensivo: limitar execuções simultâneas entre as filas. O limite
// vem do perfil de desempenho (Leve, Equilibrado ou Máximo).
let ocrSlots = 4
let ocrRunning = 0
const ocrWaiting: Array<() => void> = []
async function withOcrSlot<T>(task: () => Promise<T>) {
  while (ocrRunning >= ocrSlots) await new Promise<void>((resolve) => ocrWaiting.push(resolve))
  ocrRunning++
  try { return await task() } finally { ocrRunning--; ocrWaiting.shift()?.() }
}

const unchanged = (translation: string, source: string) => translation.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '') === source.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '')

// Aviso desenhado no lugar de uma página que a fonte publicou vazia.
async function missingPage() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="240"><rect width="800" height="240" fill="#f3eee6"/><text x="400" y="128" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#5a554e">Página indisponível na fonte</text></svg>'
  return sharp(Buffer.from(svg)).png().toBuffer()
}

type PendingPage = { pageId: number; imageId: number; pageIndex: number; height: number; all: OcrDetection[]; readable: OcrDetection[]; uncertain: boolean }

// Páginas por chamada ao modelo: menos chamadas e contexto entre páginas vizinhas.
// Capítulo inteiro numa chamada (o motor de tradução divide se passar do teto de contexto).
// O motor de tradução aceita até 300 falas por pedido; a página que fecha o lote
// pode passar do limite, então o lote fecha antes.
const BATCH_LINES = 250
const BATCH_PAGES = 1000
// Páginas do mesmo capítulo baixando ao mesmo tempo (além da que está na vez).
const PREFETCH_PAGES = 5
// Tarefas simultâneas por fase (por capítulo, inclusive da mesma obra), conforme o perfil.
let DOWNLOAD_TASKS = 4
let TRANSLATION_TASKS = 4
let RENDER_TASKS = 4
let UPGRADE_TASKS = 4
let appliedProfile = ''
function applyPerformance(database: WorksRepository['database']) {
  const { profile, limits } = currentPerformance(database)
  DOWNLOAD_TASKS = limits.downloads; TRANSLATION_TASKS = limits.translation; RENDER_TASKS = limits.render; UPGRADE_TASKS = limits.upgrade
  ocrSlots = limits.ocrSlots
  void configureMl({ device: limits.ocrDevice, threads: limits.ocrThreads })
  sharp.concurrency(limits.imageThreads)
  const key = `${profile}:${JSON.stringify(limits)}`
  if (key !== appliedProfile) { appliedProfile = key; console.info('[KOMA] Perfil de desempenho', { profile, ...limits }) }
  // Vagas novas de OCR liberam quem esperava.
  while (ocrRunning < ocrSlots && ocrWaiting.length) ocrWaiting.shift()?.()
}

// Tempo gasto em cada etapa por capítulo (só números, para medir os perfis).
const stageTimes = new Map<number, { download: number; ocr: number; translate: number; pages: number }>()
function addStage(chapterId: number, stage: 'download' | 'ocr' | 'translate', ms: number, pages = 0) {
  const entry = stageTimes.get(chapterId) || { download: 0, ocr: 0, translate: 0, pages: 0 }
  entry[stage] += ms; entry.pages += pages
  stageTimes.set(chapterId, entry)
}

export class WorkAutomation {
  constructor(private readonly dependencies: Dependencies) {}

  private async recognize(chapter: ChapterRow, page: PageRow, imageId: number) {
    const d = this.dependencies
    const image = d.repository.database.prepare('SELECT original_path FROM section_images WHERE id=?').get(imageId) as { original_path: string }
    const bytes = fs.readFileSync(image.original_path)
    let detections: OcrDetection[]
    if (page.ocr_json) detections = JSON.parse(page.ocr_json)
    else {
      detections = await withOcrSlot(async () => {
        const started = Date.now()
        const result = await d.extract(bytes, chapter.language)
        addStage(chapter.id, 'ocr', Date.now() - started, 1)
        const ordered = orderDetections(result.detections || [], chapter.language === 'ja')
        for (const detection of ordered) Object.assign(detection, await balloonColors(bytes, detection))
        return ordered
      })
      d.repository.recognized(page.id, detections)
    }
    if (detections.some((detection) => detection.ocr_error || !detection.ocr_text?.trim()) && !page.recovery_attempted && d.recover) {
      detections = await withOcrSlot(() => d.recover!(bytes, detections, chapter.language))
      d.repository.recognized(page.id, detections)
      d.repository.database.prepare('UPDATE work_pages SET recovery_attempted=1 WHERE id=?').run(page.id)
    }
    return detections
  }

  private async translateBatch(chapter: ChapterRow, batch: PendingPage[]) {
    const d = this.dependencies
    if (!batch.length) return
    // Metade de baixo de um balão cortado entre imagens não vai ao modelo: a
    // metade de cima já leva o texto inteiro, e as duas usam a mesma tradução.
    const partners = new Map<OcrDetection, OcrDetection>()
    batch.forEach((item, index) => {
      const previous = batch[index - 1]
      if (!previous || previous.pageIndex !== item.pageIndex - 1) return
      for (const [top, bottom] of splitBalloons(previous.readable.filter((d) => d.continued), previous.height, item.readable.filter((d) => d.continues))) partners.set(bottom, top)
    })
    // Marca d'água do site lida em pedaços nas páginas não vai ao modelo nem é desenhada.
    const marks = repeatedMarks(batch.map((item) => ({ height: item.height, detections: item.readable })))
    const sent = batch.flatMap((item) => item.readable.filter((detection) => !partners.has(detection) && !marks.has(detection)))
    const texts = sent.map((detection) => detection.ocr_text!.trim())
    let result: { translations: string[]; flagged?: number[]; skipped?: number[] }
    const started = Date.now()
    try {
      result = await d.translate(texts, chapter.language, d.repository.row(chapter.work_id)?.target_language || 'pt-br', workGlossary(d.repository.database, chapter.work_id))
      addStage(chapter.id, 'translate', Date.now() - started)
      // Diagnóstico sem conteúdo: apenas contagens e duração.
      console.info('[KOMA] Lote traduzido', { chapterId: chapter.id, pages: batch.length, lines: texts.length, flagged: result.flagged?.length || 0, ms: Date.now() - started })
      const skipped = new Set(result.skipped || [])
      if (result.translations.length !== texts.length || result.translations.some((value, index) => !value?.trim() && !skipped.has(index))) throw new TranslationError('incomplete_response', 'A tradução não concluiu todos os balões.', 502)
    } catch (error) {
      if (error instanceof TranslationError && ['ocr_uncertain','manual_review_required','invalid_response','incomplete_response'].includes(error.code)) { for (const item of batch) d.repository.pageReview(item.pageId,error.message); batch.length = 0; return }
      throw error
    }
    const flagged = new Set(result.flagged || [])
    // Tradução de cada fala enviada; fala ilegível que o modelo devolveu sem
    // traduzir (ex.: "ACIM") fica no original em vez de desenhar lixo.
    const translated = new Map<OcrDetection, { value: string; doubtful: boolean }>()
    sent.forEach((detection, index) => {
      const value = result.translations[index] || ''
      translated.set(detection, { value: flagged.has(index) && unchanged(value, detection.ocr_text || '') ? '' : value, doubtful: flagged.has(index) })
    })
    d.repository.database.transaction(() => {
      for (const item of batch) {
        // Leitura que o modelo achou duvidosa: a IA lê o recorte da imagem depois (visionReview).
        if (item.readable.some((detection) => translated.get(detection)?.doubtful)) {
          for (const detection of item.readable) if (translated.get(detection)?.doubtful) detection.doubtful = true
          d.repository.database.prepare('UPDATE work_pages SET ocr_json=? WHERE id=?').run(JSON.stringify(item.all), item.pageId)
        }
        const values = item.readable.map((detection) => translated.get(partners.get(detection) || detection)?.value || '')
        const doubtful = item.readable.filter((detection) => !partners.has(detection) && translated.get(detection)?.doubtful).length
        d.sections.replaceImageOcrItems(item.imageId, item.readable, new Map(values.map((value, index) => [index, value])))
        // Nova tradução: a imagem final será gerada de novo.
        d.repository.database.prepare('UPDATE section_images SET translated_path=NULL WHERE id=?').run(item.imageId)
        d.sections.markImageCompleted(item.imageId)
        // Página com diálogos traduzidos é legível; balões sem texto reconhecido
        // (efeitos, arte) ficam no original e são apenas informados.
        const notes = [item.uncertain ? 'Alguns balões continuam ilegíveis após nova tentativa local e permanecem no original.' : '', doubtful ? `${doubtful} fala(s) com contexto ou OCR incerto segundo o modelo; tradução aplicada.` : ''].filter(Boolean)
        d.repository.pageReady(item.pageId, notes.join(' '))
      }
      rememberNames(d.repository.database, chapter.work_id, sent.map((detection) => ({ source: detection.ocr_text || '', translation: translated.get(detection)?.value || '' })))
    })()
    batch.length = 0
  }

  async synchronize(work: WorkRow, signal: AbortSignal) {
    const { repository } = this.dependencies
    repository.stage(work.id, 'discovering')
    try {
      if (this.dependencies.metadata) {
        try {
          const metadata = await this.dependencies.metadata(work.source_id,signal)
          repository.cache(metadata)
          // Mantém a sinopse já traduzida enquanto o texto da fonte não mudar.
          const previous = JSON.parse(repository.row(work.id)?.metadata_json || '{}') as CatalogWork
          if (previous.localized && previous.description === metadata.description) metadata.localized = previous.localized
          repository.database.prepare('UPDATE works SET metadata_json=? WHERE id=?').run(JSON.stringify(metadata),work.id)
          const sources = await this.dependencies.inspectSources?.(metadata,signal) || []
          for (const source of sources) repository.database.prepare('INSERT INTO work_source_checks VALUES(?,?,?,?,?,?) ON CONFLICT(work_id,kind,url) DO UPDATE SET status=excluded.status,message=excluded.message,checked_at=excluded.checked_at').run(work.id,source.kind,source.url,source.status,source.message,new Date().toISOString())
        } catch { if (signal.aborted) return }
      }
      repository.syncChapters(work.id, this.dependencies.discover ? await this.dependencies.discover(repository,work,signal) : await this.dependencies.chapters(work.source_id, signal))
    }
    catch (error) {
      if (signal.aborted) return
      repository.syncFailed(work, error instanceof SourceError ? error.message : 'Não foi possível atualizar a lista de capítulos.', error instanceof SourceError && error.retryable)
    }
  }

  async prepare(chapter: ChapterRow, signal: AbortSignal, downloadOnly = false) {
    const d = this.dependencies
    const work = d.repository.row(chapter.work_id)
    if (!work || work.paused) return
    const existingPortuguese = sameLanguage(chapter.language, work.target_language || 'pt-br')
    const cooldown = d.repository.cooldown()
    if (!downloadOnly && !existingPortuguese && (cooldown || !d.authorized())) {
      const message = 'Ative a tradução e autorize os provedores em Preferências. A fila continuará automaticamente depois disso.'
      d.repository.chapterStage(chapter.id, 'blocked', cooldown?.message || message, cooldown?.retryAt || Date.now() + 60000)
      d.repository.stage(work.id, 'blocked', cooldown?.message || message)
      return
    }
    const guard = () => {
      if (signal.aborted || d.repository.row(work.id)?.paused) throw new SourceError('Processamento pausado.', false, 'paused')
    }
    let sectionId = chapter.section_id
    try {
      guard()
      d.repository.stage(work.id, 'downloading')
      d.repository.chapterStage(chapter.id, 'downloading')
      const stored = d.repository.pages(chapter.id)
      const pages = stored.length && stored.every((page) => page.image_id) ? stored.map((page) => ({ name: page.source_file, url: '' })) : await d.pages(chapter.source_id, signal)
      guard()
      if (stored.length && (stored.length !== pages.length || stored.some((page) => page.source_file !== pages[page.page_index]?.name))) throw new SourceError('A fonte alterou as páginas deste capítulo. Os arquivos já obtidos foram preservados; confira a versão antes de continuar.')
      d.repository.seedPages(chapter.id, pages.map((page) => page.name))
      const langs = { sourceLang: chapter.language, targetLang: targetInfo(work.target_language).code, providerLang: 'kpassword' }
      if (!sectionId) {
        sectionId = d.sections.createSectionWithImages(work.user_id, { ...langs, name: `${work.title} — ${chapter.number ? `Capítulo ${chapter.number}` : chapter.title || 'Especial'}` }, [])
        d.repository.section(chapter.id, sectionId)
      }
      let prepared = 0
      const batch: PendingPage[] = []
      const unreadable: number[] = []
      const skipOcr = existingPortuguese
      const rows = d.repository.pages(chapter.id)
      // As próximas páginas sem imagem já vão sendo baixadas em paralelo (o limite
      // por site fica em source-http); a gravação e o OCR seguem na ordem.
      const fetching = new Map<number, Promise<{ bytes: Buffer; mime: string }>>()
      const fetchPage = (index: number) => {
        let promise = fetching.get(index)
        if (!promise) {
          promise = d.download(pages[index].url, signal)
          promise.catch(() => { /* Tratado quando a página chega na vez dela. */ })
          fetching.set(index, promise)
        }
        return promise
      }
      const prefetch = (from: number) => {
        let started = 0
        for (const row of rows) {
          if (row.page_index < from || row.image_id || fetching.has(row.page_index) || !pages[row.page_index]?.url) continue
          if (++started > PREFETCH_PAGES) break
          void fetchPage(row.page_index)
        }
      }
      for (const page of rows) {
        guard()
        if (page.state === 'ready' || page.state === 'review' || downloadOnly && page.image_id && (page.ocr_json || skipOcr)) continue
        if (prepared >= (downloadOnly ? Infinity : d.quantum || Infinity)) {
          await this.translateBatch(chapter, batch)
          d.repository.chapterStage(chapter.id,'queued'); d.repository.stage(work.id,'queued','Preparação em andamento. A fila alterna entre suas obras.'); return
        }
        prepared++; d.repository.progressed(work.id)
        try {
        let imageId = page.image_id
        if (!imageId) {
          // Recuperar também a janela de interrupção entre gravar a imagem e o checkpoint.
          let image = d.repository.database.prepare('SELECT id,original_path FROM section_images WHERE section_id=? AND order_index=?').get(sectionId, page.page_index) as { id: number; original_path: string } | undefined
          if (!image) {
            d.repository.chapterStage(chapter.id, 'downloading')
            d.repository.stage(work.id, 'downloading')
            const downloadStarted = Date.now()
            prefetch(page.page_index)
            let data = await fetchPage(page.page_index)
            // Página publicada vazia na fonte (0 bytes): tenta mais uma vez e, se
            // continuar vazia, entra um aviso no lugar, para o capítulo não travar.
            if (!data.bytes.length) data = await d.download(pages[page.page_index].url, signal)
            let missing = false
            if (!data.bytes.length) { data = { ...data, bytes: await missingPage() }; missing = true }
            addStage(chapter.id, 'download', Date.now() - downloadStarted)
            const info = await sharp(data.bytes, { limitInputPixels: 50000000 }).metadata()
            if (!['jpeg', 'png', 'webp', 'avif'].includes(info.format || '') || !info.width || !info.height) throw new SourceError('A página recebida não é uma imagem compatível.')
            d.sections.appendImagesToSection(work.user_id, sectionId, [{ name: page.source_file, type: `image/${info.format === 'jpeg' ? 'jpeg' : info.format}`, buffer: data.bytes }])
            image = d.repository.database.prepare('SELECT id,original_path FROM section_images WHERE section_id=? AND order_index=?').get(sectionId, page.page_index) as { id: number; original_path: string }
            d.repository.downloaded(page.id, image.id, info.width, info.height)
            if (missing) {
              d.sections.markImageCompleted(image.id)
              d.repository.pageReady(page.id, 'A fonte publicou esta página vazia; ela foi substituída por um aviso.')
              continue
            }
          } else {
            const info = await sharp(image.original_path, { limitInputPixels: 50000000 }).metadata()
            d.repository.downloaded(page.id, image.id, info.width!, info.height!)
          }
          imageId = image.id
        }
        if (existingPortuguese) {
          d.sections.markImageCompleted(imageId)
          d.repository.pageReady(page.id)
          continue
        }
        guard()
        // OCR local roda já na fila de download, sem depender do cofre; a
        // tradução encontra as páginas reconhecidas e só chama os modelos.
        if (!downloadOnly && !page.ocr_json) { d.repository.chapterStage(chapter.id, 'ocr'); d.repository.stage(work.id, 'ocr') }
        const detections = await this.recognize(chapter, d.repository.pages(chapter.id).find((row) => row.id === page.id)!, imageId)
        if (downloadOnly) continue
        const uncertain = detections.some((detection) => detection.ocr_error || !detection.ocr_text?.trim())
        const readable = detections.filter((detection) => !detection.ocr_error && detection.ocr_text?.trim())
        if (readable.length) {
          const row = d.repository.pages(chapter.id).find((item) => item.id === page.id)!
          batch.push({ pageId: page.id, imageId, pageIndex: page.page_index, height: row.height || 0, all: detections, readable, uncertain })
          if (batch.length >= BATCH_PAGES || batch.reduce((sum, item) => sum + item.readable.length, 0) >= BATCH_LINES) {
            guard()
            d.repository.chapterStage(chapter.id, 'translating'); d.repository.stage(work.id, 'translating')
            await this.translateBatch(chapter, batch)
          }
          continue
        }
        d.sections.markImageCompleted(imageId)
        // Balão sem texto legível (reticências, efeito, metade de balão de outra
        // página): não há o que traduzir, e a página não deixa o capítulo pendente.
        // Só se o capítulo inteiro ficar sem fala legível isso vira pendência (abaixo).
        if (uncertain) unreadable.push(page.id)
        d.repository.pageReady(page.id, uncertain ? 'Balão sem texto legível; original preservado.' : 'Nenhum diálogo foi detectado nesta página; original preservado.')
        } catch (error) {
          if (error instanceof TranslationError && ['ocr_uncertain','manual_review_required','invalid_response','incomplete_response'].includes(error.code)) { d.repository.pageReview(page.id,error.message); continue }
          throw error
        }
      }
      if (batch.length) {
        guard()
        d.repository.chapterStage(chapter.id, 'translating'); d.repository.stage(work.id, 'translating')
        await this.translateBatch(chapter, batch)
      }
      guard()
      // Balão cortado entre duas imagens: as metades são lidas juntas e recebem uma tradução só.
      // Se falhar, as metades continuam com a tradução de cada uma.
      if (!downloadOnly && !existingPortuguese) await joinSplitBalloons(d.repository.database, chapter.id, chapter.language, d.extract, (texts, source) => d.translate(texts, source, work.target_language || 'pt-br', workGlossary(d.repository.database, chapter.work_id)))
        .catch(() => console.warn('[KOMA] Falas cortadas entre imagens não foram juntadas', { chapterId: chapter.id }))
      // Falas de leitura duvidosa: a IA lê o recorte da imagem.
      if (!downloadOnly && !existingPortuguese && d.read) await visionReview(d.repository.database, chapter.id, chapter.language, (items, source) => d.read!(items, source, work.target_language || 'pt-br', workGlossary(d.repository.database, chapter.work_id)))
        .catch(() => console.warn('[KOMA] Releitura das falas duvidosas pela IA falhou', { chapterId: chapter.id }))
      if (downloadOnly && !existingPortuguese) {
        d.repository.chapterStage(chapter.id, 'downloaded')
        d.repository.stage(work.id, 'downloaded', 'Originais deste capítulo salvos. A tradução será retomada separadamente.')
        return
      }
      const translated = (d.repository.database.prepare("SELECT COUNT(*) AS n FROM section_image_ocr_items o JOIN section_images i ON i.id=o.section_image_id WHERE i.section_id=? AND TRIM(o.translated_text)<>''").get(sectionId) as {n:number}).n
      // Nenhuma fala legível no capítulo inteiro: a leitura falhou (versão sem texto
      // reconhecível); as páginas ficam pendentes e outra versão é tentada.
      if (!existingPortuguese && !translated) for (const id of unreadable) d.repository.pageReview(id, 'O OCR não conseguiu reconhecer o texto após nova tentativa. Original preservado; a preparação das demais páginas continua.')
      if(!existingPortuguese && !translated && d.repository.pages(chapter.id).every(page=>!JSON.parse(page.ocr_json || '[]').length)) {
        for(const page of d.repository.pages(chapter.id))d.repository.pageReview(page.id,'Não foi possível confirmar os diálogos deste capítulo. A ausência de detecção não comprova ausência de texto; originais preservados.')
      }
      const hasReview = d.repository.pages(chapter.id).some((page) => page.state === 'review')
      if (hasReview && !translated && d.repository.alternate(d.repository.chapter(chapter.id)!)) { d.repository.stage(work.id,'queued','Tentando outra versão do mesmo capítulo.'); return }
      d.sections.setSectionStatus(sectionId, { status: hasReview ? 'partial' : 'completed', internalStatus: 'idle' })
      d.repository.completeChapter(chapter)
      const times = stageTimes.get(chapter.id)
      if (times) {
        stageTimes.delete(chapter.id)
        console.info('[KOMA] Etapas do capítulo', { chapterId: chapter.id, profile: appliedProfile.split(':')[0], pagesOcr: times.pages, downloadMs: times.download, ocrMs: times.ocr, translateMs: times.translate })
        try { recordStageTimes(d.repository.database, { chapterId: chapter.id, profile: appliedProfile.split(':')[0], pages: times.pages, downloadMs: times.download, ocrMs: times.ocr, translateMs: times.translate }) } catch { /* Painel é só informativo. */ }
      }
    } catch (error) {
      if (sectionId) d.sections.setSectionStatus(sectionId, { status: 'partial', internalStatus: 'idle' })
      if (signal.aborted || (error instanceof SourceError && error.code === 'paused')) { d.repository.chapterStage(chapter.id, 'queued'); return }
      console.warn('[KOMA] Falha ao preparar capítulo', { chapterId: chapter.id, downloadOnly, code: error instanceof SourceError || error instanceof TranslationError ? error.code : 'unexpected' })
      const message = error instanceof SourceError || error instanceof TranslationError ? error.message : 'Não foi possível preparar o capítulo. Os arquivos e etapas concluídas foram preservados.'
      const blocked = error instanceof TranslationError && ['bridge_unavailable', 'bridge_timeout', 'consent_required', 'not_configured', 'settings_changed', 'user_denied', 'approval_expired', 'session_expired', 'permission_revoked', 'key_not_found', 'credential_ambiguous', 'quota_exceeded', 'bridge_busy','provider_http_error','unsupported_operation'].includes(error.code)
      // Endereço de imagem recusado por segurança também tenta outra versão: o
      // endereço recusado nunca é baixado, só se troca de fonte.
      if (error instanceof SourceError && (!error.retryable || chapter.attempts >= 2 || error.code === 'content_unavailable') && d.repository.alternate(d.repository.chapter(chapter.id)!)) { d.repository.stage(work.id,'queued','A versão falhou; tentando outra publicação disponível do capítulo.'); return }
      // Falha passageira do provedor/fila nunca vira erro definitivo: tenta de novo com espera crescente.
      const transient = error instanceof TranslationError && ['provider_unavailable','provider_failed','translation_busy'].includes(error.code)
      const automatic = transient || error instanceof SourceError && error.retryable && chapter.attempts < 2
      d.repository.database.prepare('UPDATE work_chapters SET attempts=attempts+1 WHERE id=?').run(chapter.id)
      const retryAt = error instanceof TranslationError && (blocked || automatic) ? d.repository.deferTranslation(error.code,message) : 0
      d.repository.chapterStage(chapter.id, blocked ? 'blocked' : automatic ? 'queued' : 'error', message, retryAt || (automatic ? Date.now() + 60000 * Math.min(30, chapter.attempts + 1) : 0))
      d.repository.stage(work.id, blocked ? 'blocked' : 'error', message)
    }
  }
}

function processStarted(pid: number) {
  try { const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')')+1).trim().split(/\s+/)[19] || '' } catch { return '' }
}
export function claimAutomationLock(repository: WorksRepository, owner: string, pid = process.pid) {
  return repository.database.transaction(() => {
    const held = repository.database.prepare('SELECT * FROM automation_lock WHERE id=1').get() as { owner: string; pid: number; process_started: string } | undefined
    if (held?.owner === owner) return true
    if (held && held.process_started && processStarted(held.pid) === held.process_started) return false
    repository.database.prepare('INSERT INTO automation_lock VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,pid=excluded.pid,process_started=excluded.process_started').run(owner, pid, processStarted(pid))
    return true
  })()
}

type ActiveTask = { workId: number; chapterId?: number; phase: 'sync' | 'download' | 'prepare'; controller: AbortController }
type WorkerState = { timer: ReturnType<typeof setTimeout> | null; owner: string; active: Map<string,ActiveTask>; rendering: Set<number>; renderFailed: Set<number>; upgrading: Set<number>; joining: Set<number>; upgradeRetry: Map<number,number>; synopsis: boolean; synopsisRetryAt: number }
const globals = globalThis as typeof globalThis & { __komaAutomation?: WorkerState }
export function pauseRunningWork(id: number) { for (const task of globals.__komaAutomation?.active.values() || []) if (task.workId === id) task.controller.abort() }

export function startWorkAutomation() {
  if (process.env.KOMA_DESKTOP !== '1' || process.env.KOMA_AUTOMATION_DISABLED === '1' || globals.__komaAutomation) return
  const repository = worksRepository
  const state: WorkerState = { owner: crypto.randomUUID(), timer: null, active:new Map(), rendering:new Set(), renderFailed:new Set(), upgrading:new Set(), joining:new Set(), upgradeRetry:new Map(), synopsis:false, synopsisRetryAt:0 }
  globals.__komaAutomation = state
  const engineSections = new SectionsRepository()
  const engine = new WorkAutomation({
    repository, sections: engineSections, chapters: listSourceChapters, pages: chapterPages, discover: discoverWorkChapters,
    quantum: BATCH_PAGES, recover: recoverOcr, metadata: catalogMetadata, inspectSources: inspectPublicationSources,
    download: (url, signal) => sourceBytes(url, true, signal), extract: extractTextBoxesNode,
    translate: (texts, source, target, glossary) => contextualTranslation.translate(texts, source, target, glossary),
    read: (items, source, target, glossary) => contextualTranslation.readImages(items, source, target, glossary),
    authorized: () => getTranslationSettings().enabled,
  })
  // Pedidos de "refazer leitura e desenho" de obras inteiras (OCR local de novo;
  // só os balões cujo texto mudou voltam ao tradutor).
  try {
    const request = repository.database.prepare("SELECT value FROM kv_store WHERE key='koma:reprocess-works:v1'").get() as { value: string } | undefined
    const ids = (request ? JSON.parse(request.value) : []).filter((id: unknown) => Number.isInteger(id)) as number[]
    if (ids.length) repository.database.transaction(() => {
      repository.database.prepare(`UPDATE work_pages SET upgrade_pending=1 WHERE image_id IS NOT NULL AND state IN ('ready','review')
        AND chapter_id IN (SELECT id FROM work_chapters WHERE work_id IN (${ids.map(() => '?').join(',')}))`).run(...ids)
      repository.database.prepare("DELETE FROM kv_store WHERE key='koma:reprocess-works:v1'").run()
      console.info('[KOMA] Obras marcadas para refazer leitura e desenho', { works: ids.length })
    })()
  } catch { /* Pedido inválido: ignorado. */ }
  // O KOMA trabalha com prioridade baixa: o que o usuário estiver fazendo vem primeiro.
  try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL) } catch { /* Sem permissão: segue na prioridade atual. */ }
  // Ao abrir, as telas vêm primeiro: o trabalho pesado (procura diária, downloads,
  // OCR, tradução e desenho) começa depois de WARMUP_MS e da detecção da placa de
  // vídeo, para os modelos carregarem uma vez só, já no dispositivo certo.
  const warmUntil = Date.now() + Number(process.env.KOMA_WARMUP_MS ?? 120000)
  let gpuChecked = false
  void detectGpu(probeGpu).then(() => applyPerformance(repository.database)).finally(() => { gpuChecked = true })
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
        state.active.set(key,{ workId, chapterId, phase, controller })
        void run(controller.signal).catch(() => {
          // Registrar só o tipo da falha; nunca conteúdo de páginas ou credenciais.
          console.error('[KOMA] Falha inesperada na fila', { workId, phase })
        }).finally(() => state.active.delete(key))
      }
      const sync = repository.pendingSync([...state.active.values()].map(task=>task.workId))
      if (sync) launch(sync.id,'sync',signal=>engine.synchronize(sync,signal))
      if (!heavy) return
      // Downloads independem do cofre e continuam durante a espera da tradução.
      while ([...state.active.values()].filter(task=>task.phase==='download').length < DOWNLOAD_TASKS) {
        const excluded = [...state.active.values()].filter(task=>task.phase==='sync').map(task=>task.workId)
        const busy = [...state.active.values()].flatMap(task=>task.chapterId ? [task.chapterId] : [])
        const chapter = repository.nextDownload(excluded,busy)
        if (!chapter) break
        launch(chapter.work_id,'download',signal=>engine.prepare(chapter,signal,true),chapter.id)
      }
      // Capítulos em paralelo, inclusive da mesma obra; o cofre limita as chamadas.
      while ([...state.active.values()].filter(task=>task.phase==='prepare').length < TRANSLATION_TASKS && !repository.cooldown()) {
        const busy = [...state.active.values()].flatMap(task=>task.chapterId ? [task.chapterId] : [])
        const excluded = [...state.active.values()].filter(task=>task.phase==='sync').map(task=>task.workId)
        const chapter = repository.nextChapter(excluded,true,busy)
        if (!chapter) break
        launch(chapter.work_id,'prepare',signal=>engine.prepare(chapter,signal),chapter.id)
      }
      // Atualização das páginas já traduzidas (novo OCR, traduções reaproveitadas).
      if (state.upgrading.size < UPGRADE_TASKS && !repository.cooldown() && getTranslationSettings().enabled) {
        const waiting = [...state.upgradeRetry].filter(([,until])=>until>Date.now()).map(([id])=>id)
        for (const page of nextPagesToUpgrade(repository.database,[...state.upgrading,...waiting],UPGRADE_TASKS-state.upgrading.size)) {
          state.upgrading.add(page.id)
          void upgradeWorkPage(repository.database,page,async (bytes,language)=>{
            const detections = await withOcrSlot(async()=>orderDetections((await extractTextBoxesNode(bytes,language)).detections || [],language==='ja'))
            for (const detection of detections) Object.assign(detection, await balloonColors(bytes, detection))
            return detections
          },(texts,source)=>contextualTranslation.translate(texts,source,page.target_language || 'pt-br',workGlossary(repository.database,page.work_id)),(imageId,detections,translations)=>engineSections.replaceImageOcrItems(imageId,detections,translations))
            .then(async()=>{
              state.upgradeRetry.delete(page.id)
              // Última página relida do capítulo: as falas cortadas entre imagens são lidas juntas de novo.
              const pending = (repository.database.prepare('SELECT COUNT(*) AS n FROM work_pages WHERE chapter_id=? AND upgrade_pending=1').get(page.chapter_id) as {n:number}).n
              if (pending || state.joining.has(page.chapter_id)) return
              state.joining.add(page.chapter_id)
              try {
                await joinSplitBalloons(repository.database,page.chapter_id,page.language,async(bytes,language)=>withOcrSlot(()=>extractTextBoxesNode(bytes,language)),(texts,source)=>contextualTranslation.translate(texts,source,page.target_language || 'pt-br',workGlossary(repository.database,page.work_id)))
                await visionReview(repository.database,page.chapter_id,page.language,(items,source)=>contextualTranslation.readImages(items,source,page.target_language || 'pt-br',workGlossary(repository.database,page.work_id)))
              }
              finally { state.joining.delete(page.chapter_id) }
            })
            .catch(()=>{ state.upgradeRetry.set(page.id,Date.now()+10*60000); console.error('[KOMA] Falha ao atualizar página traduzida', { pageId: page.id }) })
            .finally(()=>state.upgrading.delete(page.id))
        }
      }
      // Sinopse e gêneros no idioma da interface, uma obra por vez.
      if (!state.synopsis && Date.now() >= state.synopsisRetryAt && !repository.cooldown() && getTranslationSettings().enabled) {
        state.synopsis = true
        void localizeNextWork(repository.database, getLanguageSettings(repository.database).ui, (texts, source, target) => contextualTranslation.translate(texts, source, target))
          .then((id) => { if (id === null) state.synopsisRetryAt = Date.now() + 60000 })
          .catch(() => { state.synopsisRetryAt = Date.now() + 10 * 60000; console.error('[KOMA] Falha ao traduzir a sinopse') })
          .finally(() => { state.synopsis = false })
      }
      // Imagens finais em PT-BR (texto original apagado e tradução desenhada).
      clearEmptyRenders(repository.database)
      if (state.rendering.size < RENDER_TASKS) {
        for (const page of nextPagesToRender(repository.database,[...state.rendering,...state.renderFailed],RENDER_TASKS-state.rendering.size)) {
          state.rendering.add(page.id)
          void renderWorkPage(repository.database,page.id).catch(() => { state.renderFailed.add(page.id); console.error('[KOMA] Falha ao gerar página traduzida', { imageId: page.id }) }).finally(() => state.rendering.delete(page.id))
        }
      }
      // Capítulos cujas páginas traduzidas terminaram de ser desenhadas ficam prontos.
      for (const chapterId of chaptersDoneRendering(repository.database, [...state.renderFailed])) {
        const chapter = repository.chapter(chapterId)
        if (chapter) repository.completeChapter(chapter, [...state.renderFailed])
      }
    } catch { /* Persistência e próxima iteração preservam a fila; nunca registrar textos/chaves. */ }
    finally { state.timer = setTimeout(tick, 2000); state.timer.unref() }
  }
  state.timer = setTimeout(tick, 1000); state.timer.unref()
  process.once('exit', () => { if (state.timer) clearTimeout(state.timer);for(const task of state.active.values())task.controller.abort(); (() => { try { repository.database.prepare('DELETE FROM automation_lock WHERE owner=?').run(state.owner) } catch { /* SQLite pode já estar fechado. */ } })() })
}
