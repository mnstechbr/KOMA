// Peças comuns da fila: cores do balão, ordem de leitura, vagas de OCR, perfil
// de desempenho e tempo das etapas. Separadas de worker.ts sem mudar o comportamento.
import sharp from 'sharp'
import { recoverOcr } from '@/lib/server/ocr-recovery'
import { inspectPublicationSources } from './publication-sources'
import { configureMl } from '@/lib/server/ml'
import { cudaActive, cudaDir } from './cuda-addon'
import { SectionsRepository } from '../sections/sections.repository'
import type { OcrDetection } from '../sections/sections.types'
import { WorksRepository } from './repository'
import { listSourceChapters, sourcePages } from './mangadex'
import { catalogMetadata } from './catalog'
import { discoverWorkChapters } from './chapter-sources'
import { currentPerformance } from './performance'

export async function balloonColors(bytes: Buffer, detection: OcrDetection) {
  const box = detection.box!
  const image = await sharp(bytes).metadata()
  const left = Math.max(0, Math.round(box[0] + (box[2] - box[0]) * 0.14))
  const top = Math.max(0, Math.round(box[1] + (box[3] - box[1]) * 0.14))
  const width = Math.max(1, Math.min(image.width! - left, Math.round((box[2] - box[0]) * 0.72)))
  const height = Math.max(1, Math.min(image.height! - top, Math.round((box[3] - box[1]) * 0.72)))
  const sample = await sharp(bytes)
    .extract({ left, top, width, height })
    .resize(24, 24)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer()
  const histogram = new Map<string, { count: number; rgb: number[] }>()
  for (let i = 0; i < sample.length; i += 3) {
    const rgb = [sample[i], sample[i + 1], sample[i + 2]]
    const key = rgb.map((c) => Math.round(c / 32)).join(',')
    const entry = histogram.get(key) || { count: 0, rgb: [0, 0, 0] }
    entry.count++
    rgb.forEach((value, channel) => {
      entry.rgb[channel] += value
    })
    histogram.set(key, entry)
  }
  const dominant = [...histogram.values()].sort((a, b) => b.count - a.count)[0]
  const rgb = dominant.rgb.map((value) => Math.round(value / dominant.count))
  return {
    background: '#' + rgb.map((value) => value.toString(16).padStart(2, '0')).join(''),
    foreground: rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 < 128 ? '#ffffff' : '#111111',
  }
}

export interface Dependencies {
  repository: WorksRepository
  sections: Pick<
    SectionsRepository,
    'createSectionWithImages' | 'appendImagesToSection' | 'replaceImageOcrItems' | 'markImageCompleted' | 'setSectionStatus'
  >
  chapters: typeof listSourceChapters
  pages: typeof sourcePages
  download: (url: string, signal: AbortSignal) => Promise<{ bytes: Buffer; mime: string }>
  quantum?: number
  recover?: typeof recoverOcr
  metadata?: typeof catalogMetadata
  inspectSources?: typeof inspectPublicationSources
  discover?: typeof discoverWorkChapters
  extract: (bytes: Buffer, language?: string) => Promise<{ detections?: OcrDetection[] }>
  translate: (
    texts: string[],
    source: string,
    target: string,
    glossary?: string,
  ) => Promise<{ translations: string[]; flagged?: number[]; skipped?: number[] }>
  /** Leitura pela IA dos recortes de fala que o OCR leu mal (só provedores com imagem). */
  read?: (
    items: Array<{ png: Buffer; ocr: string }>,
    source: string,
    target: string,
    glossary?: string,
  ) => Promise<Array<{ source: string; text: string; skip: boolean }> | null>
  authorized: () => boolean
}

export function orderDetections(detections: OcrDetection[], rightToLeft: boolean) {
  return detections
    .filter((d) => d.box?.length === 4)
    .sort((a, b) => {
      const aa = a.box!
      const bb = b.box!
      const tolerance = Math.min(aa[3] - aa[1], bb[3] - bb[1]) * 0.4
      return Math.abs(aa[1] - bb[1]) > tolerance ? aa[1] - bb[1] : rightToLeft ? bb[0] - aa[0] : aa[0] - bb[0]
    })
}

// OCR local é intensivo: limitar execuções simultâneas entre as filas. O limite
// vem do perfil de desempenho (Leve, Equilibrado ou Máximo).
export let ocrSlots = 4
export let ocrRunning = 0
export const ocrWaiting: Array<() => void> = []
export async function withOcrSlot<T>(task: () => Promise<T>) {
  while (ocrRunning >= ocrSlots) await new Promise<void>((resolve) => ocrWaiting.push(resolve))
  ocrRunning++
  try {
    return await task()
  } finally {
    ocrRunning--
    ocrWaiting.shift()?.()
  }
}

export const unchanged = (translation: string, source: string) =>
  translation.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '') === source.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '')

// Aviso desenhado no lugar de uma página que a fonte publicou vazia.
export async function missingPage() {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="240"><rect width="800" height="240" fill="#f3eee6"/><text x="400" y="128" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#5a554e">Página indisponível na fonte</text></svg>'
  return sharp(Buffer.from(svg)).png().toBuffer()
}

export type PendingPage = {
  pageId: number
  imageId: number
  pageIndex: number
  height: number
  all: OcrDetection[]
  readable: OcrDetection[]
  uncertain: boolean
}

// Páginas por chamada ao modelo: menos chamadas e contexto entre páginas vizinhas.
// Capítulo inteiro numa chamada (o motor de tradução divide se passar do teto de contexto).
// O motor de tradução aceita até 300 falas por pedido; a página que fecha o lote
// pode passar do limite, então o lote fecha antes.
export const BATCH_LINES = 250
export const BATCH_PAGES = 1000
// Páginas do mesmo capítulo baixando ao mesmo tempo (além da que está na vez).
export const PREFETCH_PAGES = 5
// Tarefas simultâneas por fase (por capítulo, inclusive da mesma obra), conforme o perfil.
export let DOWNLOAD_TASKS = 4
export let TRANSLATION_TASKS = 4
export let RENDER_TASKS = 4
export let UPGRADE_TASKS = 4
export let appliedProfile = ''
export function applyPerformance(database: WorksRepository['database']) {
  const { profile, limits } = currentPerformance(database)
  DOWNLOAD_TASKS = limits.downloads
  TRANSLATION_TASKS = limits.translation
  RENDER_TASKS = limits.render
  UPGRADE_TASKS = limits.upgrade
  ocrSlots = limits.ocrSlots
  // Complemento CUDA (opcional): só no Máximo, só o desenho; o OCR continua no WebGPU.
  void cudaActive(database)
    .catch(() => false)
    .then((cuda) =>
      configureMl({
        device: limits.ocrDevice,
        threads: limits.ocrThreads,
        drawThreads: limits.drawThreads,
        ...(cuda && profile === 'maximo' ? { drawDevice: 'cuda' as const, cudaDir: cudaDir() } : {}),
      }),
    )
  sharp.concurrency(limits.imageThreads)
  const key = `${profile}:${JSON.stringify(limits)}`
  if (key !== appliedProfile) {
    appliedProfile = key
    console.info('[KOMA] Perfil de desempenho', { profile, ...limits })
  }
  // Vagas novas de OCR liberam quem esperava.
  while (ocrRunning < ocrSlots && ocrWaiting.length) ocrWaiting.shift()?.()
}

// Tempo gasto em cada etapa por capítulo (só números, para medir os perfis).
export const stageTimes = new Map<number, { download: number; ocr: number; translate: number; pages: number }>()
export function addStage(chapterId: number, stage: 'download' | 'ocr' | 'translate', ms: number, pages = 0) {
  const entry = stageTimes.get(chapterId) || { download: 0, ocr: 0, translate: 0, pages: 0 }
  entry[stage] += ms
  entry.pages += pages
  stageTimes.set(chapterId, entry)
}
