import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { OcrDevice } from './manga-ocr-node'

// OCR e apagamento fora da thread das telas. O pacote desktop traz o worker já
// compilado (koma-ml/ml-worker.mjs, ver scripts/build-ml-worker.mjs); sem ele
// (testes, modo de desenvolvimento) tudo roda como antes, na própria thread.
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }
const shared = globalThis as typeof globalThis & {
  __komaMl?: {
    worker: Worker | null
    next: number
    pending: Map<number, Pending>
    config: { device: OcrDevice; threads: number } | null
    promo: string[]
  }
}
const state = (shared.__komaMl ||= { worker: null, next: 1, pending: new Map(), config: null, promo: [] })

function workerFile() {
  const file = process.env.KOMA_ML_WORKER || path.join(/*turbopackIgnore: true*/ process.cwd(), 'koma-ml', 'ml-worker.mjs')
  return fs.existsSync(file) ? file : null
}
function worker() {
  if (state.worker) return state.worker
  const file = workerFile()
  if (!file) return null
  const created = new Worker(file)
  created.unref()
  created.on('message', ({ id, value, error }: { id: number; value?: unknown; error?: string }) => {
    const pending = state.pending.get(id)
    if (!pending) return
    state.pending.delete(id)
    if (error !== undefined) pending.reject(new Error(error))
    else pending.resolve(value)
  })
  // Worker caiu (falta de memória, erro nativo): os pedidos em andamento falham e o próximo cria outro.
  const fail = (reason: string) => {
    if (state.worker !== created) return
    state.worker = null
    for (const pending of state.pending.values()) pending.reject(new Error(reason))
    state.pending.clear()
  }
  created.on('error', (error) => {
    console.error('[KOMA] OCR separado falhou', { message: error.message })
    fail(error.message)
  })
  created.on('exit', (code) => fail(`OCR separado encerrou (${code}).`))
  state.worker = created
  if (state.config) void call('configure', [state.config])
  if (state.promo.length) void call('promo', [state.promo])
  return created
}
function call<T>(method: string, args: unknown[], transfer: Transferable[] = []): Promise<T> {
  const target = worker()!
  const id = state.next++
  return new Promise<T>((resolve, reject) => {
    state.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
    target.postMessage({ id, method, args }, transfer as never)
  })
}
/** Nomes das fontes do usuário (marca d'água) também para o OCR separado. */
export function shareMlPromoNames(names: string[]) {
  state.promo = names
  if (worker()) void call('promo', [names]).catch(() => undefined)
}
/** O OCR roda num processo separado (pacote desktop)? */
export function separateMl() {
  return Boolean(workerFile())
}

export async function configureMl(config: { device: OcrDevice; threads: number }) {
  if (state.config && state.config.device === config.device && state.config.threads === config.threads) return
  state.config = config
  if (worker()) {
    await call('configure', [config])
    return
  }
  const [{ configureOcr }, { configureInpaint }] = await Promise.all([import('./manga-ocr-node'), import('./inpaint')])
  configureOcr(config)
  configureInpaint(config.device)
}
export async function extractText(
  bytes: Buffer,
  language = 'auto',
): Promise<Awaited<ReturnType<(typeof import('./manga-ocr-node'))['extractTextBoxesNode']>>> {
  if (worker()) return call('extract', [new Uint8Array(bytes), language])
  return (await import('./manga-ocr-node')).extractTextBoxesNode(bytes, language)
}
export async function recognizeText(
  bytes: Buffer,
  timeout = 10,
  language = 'auto',
): Promise<Awaited<ReturnType<(typeof import('./manga-ocr-node'))['recognizeImageTextNode']>>> {
  if (worker()) return call('recognize', [new Uint8Array(bytes), timeout, language])
  return (await import('./manga-ocr-node')).recognizeImageTextNode(bytes, timeout, language)
}
export async function probeGpuDevice(): Promise<{ available: boolean; ms: number | null }> {
  if (worker()) return call('probe', [])
  return (await import('./manga-ocr-node')).probeGpu()
}
/** Máscara das letras por faixa de linhas: aqui só roda as janelas pedidas; no worker, a página inteira uma vez. */
export function textMaskRows(image: Buffer): (top?: number, bottom?: number) => Promise<Uint8Array | null> {
  if (worker()) {
    let full: Promise<Uint8Array | null> | null = null
    return () => (full ||= call('mask', [new Uint8Array(image)]))
  }
  let reader: Promise<(top?: number, bottom?: number) => Promise<Uint8Array | null>> | null = null
  return async (top, bottom) => (await (reader ||= import('./inpaint').then((module) => module.textMaskReader(image))))(top, bottom)
}
/** Desenha a página traduzida (no worker, quando existe; senão com os modelos daqui). */
export async function renderPage(
  original: Buffer,
  items: import('./render-translation').RenderItem[],
  models?: import('./render-translation').EraseModels,
): Promise<Buffer> {
  if (worker()) return Buffer.from(await call<Uint8Array>('render', [new Uint8Array(original), items]))
  return (await import('./render-translation')).renderTranslatedPage(original, items, undefined, models)
}
/** Reconstrói os pixels marcados; altera "data" no lugar, como o lamaInpaint. */
export async function inpaintRegion(data: Float32Array, width: number, height: number, mask: Uint8Array) {
  if (!worker()) return (await import('./inpaint')).lamaInpaint(data, width, height, mask)
  const copy = new Float32Array(data)
  const result = await call<{ ok: boolean; data: Float32Array }>('inpaint', [copy, width, height, mask], [copy.buffer])
  data.set(result.data)
  return result.ok
}
