// Preparação de um capítulo (baixar, ler, traduzir, desenhar) e sincronização da
// obra. Separada de worker.ts sem mudar o comportamento.
import fs from 'node:fs'
import { sameLanguage, targetInfo } from '@/lib/languages'
import type { CatalogWork } from '@/lib/works'
import sharp from 'sharp'
import { TranslationError } from '../kpassword/settings'
import type { OcrDetection } from '../sections/sections.types'
import { type ChapterRow, type PageRow, type WorkRow } from './repository'
import { SourceError } from './source-http'
import { recordStageTimes } from './stage-times'
import { aggregatorFor } from './aggregators'
import { rememberNames, workGlossary } from './names'
import { joinSplitBalloons, splitBalloons } from './split-balloons'
import { repeatedMarks } from './watermark'
import { visionReview } from './vision'
import {
  balloonColors,
  orderDetections,
  withOcrSlot,
  unchanged,
  missingPage,
  BATCH_LINES,
  BATCH_PAGES,
  PREFETCH_PAGES,
  appliedProfile,
  stageTimes,
  addStage,
  type Dependencies,
  type PendingPage,
} from './worker-shared'

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
      // Nenhuma outra versão conhecida e a fonte não tem o capítulo agora (404, só
      // créditos): procura a obra de novo em todas as fontes e tenta outra vez em 6 h
      // e depois em 24 h, antes de marcar erro.
      if (error instanceof SourceError && (!error.retryable || error.code === 'content_unavailable') && chapter.attempts < 2 && error.code !== 'destination_blocked') {
        const name = aggregatorFor(chapter.source_id)?.name || (() => { try { return new URL(chapter.source_id).hostname.replace(/^www\./, '') } catch { return 'MangaDex' } })()
        const hours = chapter.attempts === 0 ? 6 : 24
        d.repository.database.transaction(() => {
          d.repository.database.prepare("DELETE FROM work_source_checks WHERE work_id=? AND url LIKE 'search:%' AND status='not_found'").run(work.id)
          d.repository.database.prepare('UPDATE works SET sync_requested=1,sync_attempts=0,sync_retry_after=0 WHERE id=?').run(work.id)
          d.repository.database.prepare('UPDATE work_chapters SET attempts=attempts+1 WHERE id=?').run(chapter.id)
        })()
        d.repository.chapterStage(chapter.id, 'queued', `Só ${name} tem este capítulo e ele não está disponível agora. O KOMA procura em outras fontes e tenta de novo em ${hours} h.`, Date.now() + hours * 3600000)
        d.repository.stage(work.id, 'queued', '')
        return
      }
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
