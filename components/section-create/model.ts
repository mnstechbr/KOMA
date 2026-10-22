// Tipos, constantes e funções da tela de importar arquivos (PDF e imagens),
// separados de section-create-form.tsx sem mudar o comportamento.

export interface LanguageOption {
  code: string
  name: string
}

export interface PreparedUploadItem {
  id: string
  sourceName: string
  files: File[]
  rawPdf?: File
  previewUrl?: string
}

export type BatchPdfUploadPhase = 'pending' | 'preparing' | 'uploading' | 'assigning-category' | 'success' | 'error'

export interface BatchPdfUploadStatus {
  phase: BatchPdfUploadPhase
  message: string
  processedPages?: number
  totalPages?: number
}

export interface PreparingState {
  currentFileName: string
  currentFileIndex: number
  totalFiles: number
  processedPages: number
  totalPages: number
}

export interface SectionCategoryResponse {
  category?: unknown
  categories?: unknown
  category_items?: unknown
  deleted_sections_count?: unknown
  message?: string
  error?: string
}

export type UploadMode = 'pdf' | 'pdf-batch' | 'images'

export const STATIC_LANGUAGES: LanguageOption[] = [
  { code: 'auto', name: 'Detectar automaticamente' },
  { code: 'en', name: 'Inglês' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'es', name: 'Espanhol' },
  { code: 'fr', name: 'Francês' },
  { code: 'de', name: 'Alemão' },
  { code: 'it', name: 'Italiano' },
  { code: 'ja', name: 'Japonês' },
  { code: 'ko', name: 'Coreano' },
  { code: 'zh-cn', name: 'Chinês Simplificado' },
  { code: 'zh-tw', name: 'Chinês Tradicional' },
  { code: 'ru', name: 'Russo' },
  { code: 'ar', name: 'Árabe' },
  { code: 'hi', name: 'Hindi' },
  { code: 'tr', name: 'Turco' },
  { code: 'nl', name: 'Holandês' },
  { code: 'pl', name: 'Polonês' },
  { code: 'uk', name: 'Ucraniano' },
  { code: 'vi', name: 'Vietnamita' },
  { code: 'id', name: 'Indonésio' },
  { code: 'th', name: 'Tailandês' },
]
export const DEFAULT_SOURCE_LANG = 'en'
export const DEFAULT_TARGET_LANG = 'pt-BR'

export const MAX_BATCH_PDFS = 3
export const MAX_BATCH_PDFS_ROLE4 = 10
export const SECTION_CATEGORY_MAX_LENGTH = 64

export function isPdfFile(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

export function isImageFile(file: File) {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(file.name)
}

export function getPdfBaseName(fileName: string) {
  return fileName.replace(/\.pdf$/i, '')
}

export function buildSectionNameSuggestionFromPdf(fileName: string) {
  return getPdfBaseName(fileName).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function buildSectionNameSuggestionFromImage(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function createUploadItemId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function getInitialBatchPdfUploadStatus(): BatchPdfUploadStatus {
  return {
    phase: 'pending',
    message: 'Aguardando envio.',
  }
}

export function getBatchPdfPhaseMeta(phase: BatchPdfUploadPhase) {
  if (phase === 'preparing') {
    return {
      label: 'Extraindo',
      className: 'text-violet-600 dark:text-violet-400',
    }
  }

  if (phase === 'uploading') {
    return {
      label: 'Enviando',
      className: 'text-blue-600 dark:text-blue-400',
    }
  }

  if (phase === 'assigning-category') {
    return {
      label: 'Categorizando',
      className: 'text-indigo-600 dark:text-indigo-400',
    }
  }

  if (phase === 'success') {
    return {
      label: 'Concluído',
      className: 'text-emerald-600 dark:text-emerald-400',
    }
  }

  if (phase === 'error') {
    return {
      label: 'Erro',
      className: 'text-red-600 dark:text-red-400',
    }
  }

  return {
    label: 'Na fila',
    className: 'text-muted-foreground',
  }
}

export function getPreparingOverallProgress(state: PreparingState | null) {
  if (!state || state.totalFiles <= 0) return 0

  const filesDoneBeforeCurrent = Math.max(0, state.currentFileIndex - 1)
  const currentFileProgress = state.totalPages > 0 ? Math.min(1, state.processedPages / state.totalPages) : 0

  const overall = ((filesDoneBeforeCurrent + currentFileProgress) / state.totalFiles) * 100
  return Math.min(100, Math.max(0, overall))
}

export function asObjectRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function resolveAuthMePayload(payload: unknown) {
  const root = asObjectRecord(payload) ?? {}
  const nestedUser = asObjectRecord(root.user) ?? {}

  return {
    role: root.role ?? nestedUser.role,
    limite: root.limite ?? nestedUser.limite,
    gerado: root.gerado ?? nestedUser.gerado,
    limit_page_upload: root.limit_page_upload ?? nestedUser.limit_page_upload,
  }
}

export function toFiniteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function normalizeSectionCategoryValue(value: unknown) {
  if (typeof value !== 'string') return ''
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.slice(0, SECTION_CATEGORY_MAX_LENGTH)
}

export function toSectionCategoryKey(value: string) {
  return normalizeSectionCategoryValue(value).toLocaleLowerCase('pt-BR')
}

export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || (typeof window !== 'undefined' && window.innerWidth < 768)
}

export function getHardwareConcurrency() {
  if (typeof navigator === 'undefined') return 4
  const cores = Number(navigator.hardwareConcurrency)
  if (!Number.isFinite(cores) || cores <= 0) return 4
  return Math.floor(cores)
}

export function getDeviceMemoryGb() {
  if (typeof navigator === 'undefined') return null
  const memory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
  if (!Number.isFinite(memory) || memory <= 0) return null
  return memory
}

export function yieldToUI() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

export function getPdfParallelChunksDefault() {
  return 4
}

export function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao converter página para imagem.'))), mimeType, quality),
  )
}

export let _canvasWebpSupport: boolean | null = null

export function canEncodeCanvasWebp() {
  if (_canvasWebpSupport !== null) return _canvasWebpSupport
  if (typeof document === 'undefined') {
    _canvasWebpSupport = false
    return _canvasWebpSupport
  }

  try {
    const probe = document.createElement('canvas')
    probe.width = 2
    probe.height = 2
    const dataUrl = probe.toDataURL('image/webp', 0.8)
    _canvasWebpSupport = dataUrl.startsWith('data:image/webp')
  } catch {
    _canvasWebpSupport = false
  }

  return _canvasWebpSupport
}

export let _pdfjsLib: typeof import('pdfjs-dist') | null = null

export async function getPdfjsLib() {
  if (!_pdfjsLib) {
    const lib = await import('pdfjs-dist')
    lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
    _pdfjsLib = lib
  }
  return _pdfjsLib
}

export async function extractPdfToImages(
  pdfFile: File,
  onProgress: (processedPages: number, totalPages: number) => void,
  options?: { maxPages?: number | null; parallelChunks?: number | null },
): Promise<File[]> {
  const pdfjsLib = await getPdfjsLib()

  const mobile = isMobileDevice()
  const useWebp = canEncodeCanvasWebp()
  const mimeType = useWebp ? 'image/webp' : 'image/jpeg'
  const ext = useWebp ? 'webp' : 'jpg'

  const arrayBuffer = await pdfFile.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise

  const totalPages = pdf.numPages
  const maxPages = typeof options?.maxPages === 'number' ? Math.max(1, Math.floor(options.maxPages)) : null
  if (maxPages !== null && totalPages > maxPages) {
    throw new Error(`PDF possui ${totalPages} páginas e excede o limite de ${maxPages} páginas por seção.`)
  }
  const baseName = getPdfBaseName(pdfFile.name)
  const results: File[] = new Array(totalPages)

  const hardwareConcurrency = getHardwareConcurrency()
  const deviceMemoryGb = getDeviceMemoryGb()
  const lowMemoryDevice = deviceMemoryGb !== null && deviceMemoryGb <= 4
  const firstPage = await pdf.getPage(1)
  const baseViewport = firstPage.getViewport({ scale: 1 })
  firstPage.cleanup()
  const baseArea = Math.max(1, baseViewport.width * baseViewport.height)

  const fileSizeMb = pdfFile.size / (1024 * 1024)
  const isHugePdf = totalPages >= 120 || fileSizeMb >= 120
  const isLargePdf = totalPages >= 60 || fileSizeMb >= 60

  const targetMegaPixels = mobile ? (isHugePdf ? 0.75 : isLargePdf ? 0.95 : 1.2) : isHugePdf ? 1.2 : isLargePdf ? 1.6 : 2.0
  const tunedMegaPixels = lowMemoryDevice ? Math.max(0.7, targetMegaPixels - (mobile ? 0.1 : 0.3)) : targetMegaPixels

  const maxScale = mobile ? 1.45 : 1.7
  const minScale = mobile ? 0.85 : 1.0
  const dynamicScale = Math.sqrt((tunedMegaPixels * 1_000_000) / baseArea)
  const scale = Math.min(maxScale, Math.max(minScale, dynamicScale))

  const imageQuality = useWebp
    ? mobile
      ? isLargePdf
        ? 0.64
        : 0.68
      : isHugePdf
        ? 0.68
        : isLargePdf
          ? 0.72
          : 0.76
    : mobile
      ? isLargePdf
        ? 0.68
        : 0.72
      : isHugePdf
        ? 0.72
        : isLargePdf
          ? 0.76
          : 0.8

  const highEndDesktop = !mobile && !lowMemoryDevice && hardwareConcurrency >= 8
  const concurrencyCap = mobile ? 4 : highEndDesktop ? 12 : lowMemoryDevice ? 6 : 9
  const baseConcurrency = Math.max(2, Math.floor(hardwareConcurrency / (mobile ? 2 : 1.5)))
  const hugePdfPenalty = isHugePdf ? 2 : 0
  const concurrency = Math.max(1, Math.min(concurrencyCap, totalPages, baseConcurrency - hugePdfPenalty))
  onProgress(0, totalPages)

  let completedCount = 0
  const requestedChunks = Math.max(1, Math.floor(options?.parallelChunks ?? getPdfParallelChunksDefault()))
  const chunkCount = Math.max(1, Math.min(requestedChunks, totalPages))
  const pagesPerChunk = Math.ceil(totalPages / chunkCount)

  type ChunkRange = { start: number; end: number }
  const ranges: ChunkRange[] = []
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const start = chunkIndex * pagesPerChunk + 1
    const end = Math.min(totalPages, start + pagesPerChunk - 1)
    if (start <= end) ranges.push({ start, end })
  }

  const workersPerChunk = Math.max(1, Math.floor(concurrency / Math.max(1, ranges.length)))

  async function runChunk(range: ChunkRange) {
    const pagesInChunk = range.end - range.start + 1
    const chunkConcurrency = Math.max(1, Math.min(workersPerChunk, pagesInChunk))
    const slots = Array.from({ length: chunkConcurrency }, () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { alpha: false })!
      return { canvas, ctx }
    })

    async function runSlot(slotIndex: number) {
      const slot = slots[slotIndex]!
      let pendingBlob: Promise<Blob> | null = null
      let pendingPageNum = -1

      for (let pageNum = range.start + slotIndex; pageNum <= range.end; pageNum += chunkConcurrency) {
        if (((pageNum - range.start) / chunkConcurrency) % 8 === 0) {
          await yieldToUI()
        }

        const page = await pdf.getPage(pageNum)
        const viewport = page.getViewport({ scale })
        slot.canvas.width = viewport.width
        slot.canvas.height = viewport.height

        await page.render({ canvasContext: slot.ctx, viewport }).promise
        page.cleanup()

        const currentBlob = canvasToBlob(slot.canvas, mimeType, imageQuality)

        if (pendingBlob !== null) {
          const blob = await pendingBlob
          results[pendingPageNum - 1] = new File([blob], `${baseName}_p${pendingPageNum}.${ext}`, { type: mimeType })
          completedCount++
          onProgress(completedCount, totalPages)
        }

        pendingBlob = currentBlob
        pendingPageNum = pageNum
      }

      if (pendingBlob !== null) {
        const blob = await pendingBlob
        results[pendingPageNum - 1] = new File([blob], `${baseName}_p${pendingPageNum}.${ext}`, { type: mimeType })
        completedCount++
        onProgress(completedCount, totalPages)
      }

      slot.canvas.width = 0
      slot.canvas.height = 0
    }

    await Promise.all(Array.from({ length: chunkConcurrency }, (_, i) => runSlot(i)))
  }

  await Promise.all(ranges.map((range) => runChunk(range)))

  pdf.cleanup()
  pdf.destroy()

  return results.filter((file): file is File => Boolean(file))
}

export async function extractPdfFirstPageThumbnail(pdfFile: File) {
  const pdfjsLib = await getPdfjsLib()
  const arrayBuffer = await pdfFile.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    disableFontFace: true,
    useSystemFonts: false,
  }).promise

  try {
    const page = await pdf.getPage(1)
    const baseViewport = page.getViewport({ scale: 1 })
    const targetWidth = 140
    const scale = Math.max(0.2, targetWidth / Math.max(1, baseViewport.width))
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return null

    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    await page.render({ canvasContext: context, viewport }).promise
    return canvas.toDataURL('image/jpeg', 0.8)
  } finally {
    pdf.cleanup()
    pdf.destroy()
  }
}

export function normalizeSectionCategoryOptions(value: unknown) {
  if (!Array.isArray(value)) return [] as string[]

  const seen = new Set<string>()
  const options: string[] = []

  for (const item of value) {
    const normalized = normalizeSectionCategoryValue(item)
    if (!normalized) continue

    const key = toSectionCategoryKey(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    options.push(normalized)

    if (options.length >= 200) break
  }

  options.sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
  return options
}

export function resolveSectionCategoryNames(payload: SectionCategoryResponse) {
  const fromCategories = normalizeSectionCategoryOptions(payload.categories)
  if (fromCategories.length > 0) return fromCategories

  const rawItems = Array.isArray(payload.category_items) ? payload.category_items : []
  const names = rawItems
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const name = (item as { name?: unknown }).name
      return typeof name === 'string' ? name : ''
    })
    .filter(Boolean)

  return normalizeSectionCategoryOptions(names)
}
