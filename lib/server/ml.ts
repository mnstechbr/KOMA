import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { OcrDevice } from './manga-ocr-node'
import type { GpuProbe } from './ocr-helpers'

// OCR e apagamento fora da thread das telas. O pacote desktop traz o worker já
// compilado (koma-ml/ml-worker.mjs, ver scripts/build-ml-worker.mjs); sem ele
// (testes, modo de desenvolvimento) tudo roda como antes, na própria thread.
// Dois workers com o mesmo arquivo: um para o OCR e outro para o desenho (máscara,
// LaMa e laços de pixels), para um não segurar o outro; cada um com seus threads.
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }
type Role = 'ocr' | 'draw'
export interface MlConfig {
  device: OcrDevice
  threads: number
  /** Threads do ONNX no desenho (detector de letras e LaMa); 0 = padrão do onnxruntime. */
  drawThreads?: number
  /** Dispositivo do desenho, quando difere do OCR (complemento CUDA). */
  drawDevice?: 'cpu' | 'webgpu' | 'cuda'
  /** Pasta do complemento CUDA (bibliotecas em lib/). */
  cudaDir?: string
}
const shared = globalThis as typeof globalThis & {
  __komaMl2?: {
    workers: Record<Role, Worker | null>
    next: number
    pending: Map<number, Pending & { role: Role }>
    config: MlConfig | null
    promo: string[]
  }
}
const state = (shared.__komaMl2 ||= { workers: { ocr: null, draw: null }, next: 1, pending: new Map(), config: null, promo: [] })

function workerFile() {
  const file = process.env.KOMA_ML_WORKER || path.join(/*turbopackIgnore: true*/ process.cwd(), 'koma-ml', 'ml-worker.mjs')
  return fs.existsSync(file) ? file : null
}
const configure = (role: Role, config: MlConfig) =>
  role === 'ocr' ? call(role, 'configure', [{ device: config.device, threads: config.threads }]) : call(role, 'configureDraw', [config])
function worker(role: Role = 'ocr') {
  if (state.workers[role]) return state.workers[role]
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
    if (state.workers[role] !== created) return
    state.workers[role] = null
    for (const [id, pending] of state.pending)
      if (pending.role === role) {
        state.pending.delete(id)
        pending.reject(new Error(reason))
      }
  }
  created.on('error', (error) => {
    console.error(role === 'ocr' ? '[KOMA] OCR separado falhou' : '[KOMA] Desenho separado falhou', { message: error.message })
    fail(error.message)
  })
  created.on('exit', (code) => fail(`${role === 'ocr' ? 'OCR' : 'Desenho'} separado encerrou (${code}).`))
  state.workers[role] = created
  if (state.config) void configure(role, state.config).catch(() => undefined)
  if (state.promo.length) void call(role, 'promo', [state.promo]).catch(() => undefined)
  return created
}
function call<T>(role: Role, method: string, args: unknown[], transfer: Transferable[] = []): Promise<T> {
  const target = worker(role)!
  const id = state.next++
  return new Promise<T>((resolve, reject) => {
    state.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, role })
    target.postMessage({ id, method, args }, transfer as never)
  })
}
/** Nomes das fontes do usuário (marca d'água) também para o OCR e o desenho separados. */
export function shareMlPromoNames(names: string[]) {
  state.promo = names
  for (const role of ['ocr', 'draw'] as const) if (state.workers[role]) void call(role, 'promo', [names]).catch(() => undefined)
}
/** O OCR roda num processo separado (pacote desktop)? */
export function separateMl() {
  return Boolean(workerFile())
}

export async function configureMl(config: MlConfig) {
  const current = state.config
  if (
    current &&
    current.device === config.device &&
    current.threads === config.threads &&
    (current.drawThreads || 0) === (config.drawThreads || 0) &&
    (current.drawDevice || '') === (config.drawDevice || '') &&
    (current.cudaDir || '') === (config.cudaDir || '')
  )
    return
  state.config = config
  if (workerFile()) {
    // Só reconfigura os workers que já existem; um novo recebe a configuração ao nascer.
    await Promise.all((['ocr', 'draw'] as const).filter((role) => state.workers[role]).map((role) => configure(role, config)))
    return
  }
  const [{ configureOcr }, { configureInpaint }] = await Promise.all([import('./manga-ocr-node'), import('./inpaint')])
  configureOcr(config)
  configureInpaint(config.drawDevice || config.device, config.drawThreads || 0, config.cudaDir || '')
}
/** Dispositivo em uso no desenho e o erro do CUDA, se ele falhou e o desenho voltou para o WebGPU. */
export async function drawDeviceStatus(): Promise<{ device: string; cudaError: string | null }> {
  if (worker('draw')) return call('draw', 'drawStatus', [])
  return (await import('./inpaint')).drawStatus()
}
export async function extractText(
  bytes: Buffer,
  language = 'auto',
): Promise<Awaited<ReturnType<(typeof import('./manga-ocr-node'))['extractTextBoxesNode']>>> {
  if (worker()) return call('ocr', 'extract', [new Uint8Array(bytes), language])
  return (await import('./manga-ocr-node')).extractTextBoxesNode(bytes, language)
}
export async function recognizeText(
  bytes: Buffer,
  timeout = 10,
  language = 'auto',
): Promise<Awaited<ReturnType<(typeof import('./manga-ocr-node'))['recognizeImageTextNode']>>> {
  if (worker()) return call('ocr', 'recognize', [new Uint8Array(bytes), timeout, language])
  return (await import('./manga-ocr-node')).recognizeImageTextNode(bytes, timeout, language)
}
export async function probeGpuDevice(): Promise<GpuProbe> {
  if (worker()) return call('ocr', 'probe', [])
  return (await import('./manga-ocr-node')).probeGpu()
}
/** Máscara das letras por faixa de linhas: aqui só roda as janelas pedidas; no worker, a página inteira uma vez. */
export function textMaskRows(image: Buffer): (top?: number, bottom?: number) => Promise<Uint8Array | null> {
  if (worker('draw')) {
    let full: Promise<Uint8Array | null> | null = null
    return () => (full ||= call('draw', 'mask', [new Uint8Array(image)]))
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
  if (worker('draw')) return Buffer.from(await call<Uint8Array>('draw', 'render', [new Uint8Array(original), items]))
  return (await import('./render-translation')).renderTranslatedPage(original, items, undefined, models)
}
/** Reconstrói os pixels marcados; altera "data" no lugar, como o lamaInpaint. */
export async function inpaintRegion(data: Float32Array, width: number, height: number, mask: Uint8Array) {
  if (!worker('draw')) return (await import('./inpaint')).lamaInpaint(data, width, height, mask)
  const copy = new Float32Array(data)
  const result = await call<{ ok: boolean; data: Float32Array }>('draw', 'inpaint', [copy, width, height, mask], [copy.buffer])
  data.set(result.data)
  return result.ok
}
