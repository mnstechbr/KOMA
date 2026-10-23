import fs from 'node:fs'
import path from 'node:path'
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'

// Apagamento do texto original com modelos: o detector de letras de quadrinho
// (comic-text-detector) marca os pixels de cada letra, e o LaMa reconstrói o
// desenho por baixo delas. Os dois são opcionais: sem os arquivos, o desenho usa
// o apagamento por cor de antes.
const MODELS = process.env.KOMA_MODELS_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'models')
// Versão só com a saída da máscara (scripts/onnx-prune.mjs): mesmos valores, metade do
// tempo na CPU. Sem ela (código-fonte sem npm run desktop:resources), o modelo completo.
const DETECTOR = [path.join(MODELS, 'comic-text-detector-seg.onnx'), path.join(MODELS, 'comic-text-detector.onnx')]
const detectorFile = () => DETECTOR.find((file) => fs.existsSync(file)) || DETECTOR[1]
const LAMA = path.join(MODELS, 'lama_fp32.onnx')
const SIDE = 1024
const LAMA_SIDE = 512

// Mesmo dispositivo do OCR (placa de vídeo no perfil Máximo); definido pelo perfil de desempenho.
// Com o complemento CUDA (opcional, só Linux com NVIDIA), o desenho usa CUDA e o OCR
// continua no WebGPU. Compartilhado entre as cópias do módulo que o Next carrega em
// cada rota (o editor de balões desenha pela rota, com os modelos já carregados pela fila).
export type DrawDevice = 'cpu' | 'webgpu' | 'cuda'
const shared = ((
  globalThis as typeof globalThis & {
    __komaInpaint?: {
      device: DrawDevice
      threads?: number
      cudaDir?: string
      cudaError?: string
      detector: Promise<ort.InferenceSession> | null
      lama: Promise<ort.InferenceSession> | null
    }
  }
).__komaInpaint ||= { device: 'cpu', threads: 0, detector: null, lama: null })
/** Dispositivo e threads do ONNX no desenho (0 = padrão do onnxruntime), conforme o perfil. */
export function configureInpaint(next: DrawDevice, threads = 0, cudaDir = '') {
  if (next === shared.device && threads === (shared.threads || 0) && cudaDir === (shared.cudaDir || '')) return
  shared.device = next
  shared.threads = threads
  shared.cudaDir = cudaDir
  if (next === 'cuda') shared.cudaError = undefined
  shared.detector = null
  shared.lama = null
}
/** Dispositivo em uso no desenho e o erro, se o CUDA falhou e o desenho voltou para o WebGPU. */
export function drawStatus() {
  return { device: shared.device, cudaError: shared.cudaError || null }
}
const intraThreads = () => Number(process.env.KOMA_INPAINT_THREADS) || shared.threads || 0
const options = (device: DrawDevice): ort.InferenceSession.SessionOptions => ({
  executionProviders: device === 'cuda' ? ['cuda', 'cpu'] : device === 'webgpu' ? ['webgpu', 'cpu'] : ['cpu'],
  graphOptimizationLevel: 'all',
  logSeverityLevel: 3,
  // KOMA_INPAINT_THREADS só para medições (tests/pipeline-benchmark.real.test.ts).
  ...(intraThreads() > 0 ? { intraOpNumThreads: intraThreads() } : {}),
})

// Bibliotecas da NVIDIA que o provider CUDA do onnxruntime pede, na ordem de dependência.
export const CUDA_LIBS = [
  'libcudart.so.13',
  'libcublasLt.so.13',
  'libcublas.so.13',
  'libcufft.so.12',
  'libcurand.so.10',
  'libnvrtc.so.13',
  'libcudnn.so.9',
]
export const CUDA_PROVIDER = 'libonnxruntime_providers_cuda.so'
let cudaPrepared = ''
/**
 * Deixa o CUDA pronto sem reiniciar o app: o provider precisa estar ao lado do
 * onnxruntime (link para a pasta do complemento) e as bibliotecas da NVIDIA são
 * carregadas pelo caminho completo antes, com RTLD_NODELETE, para o provider achá-las
 * pelo nome sem LD_LIBRARY_PATH.
 */
export function prepareCuda(
  dir: string,
  ortDir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'node_modules/onnxruntime-node/bin/napi-v6/linux/x64'),
  load = process.dlopen,
) {
  if (cudaPrepared === dir) return
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('O complemento CUDA só funciona no Linux x64.')
  const lib = path.join(dir, 'lib')
  for (const name of [...CUDA_LIBS, CUDA_PROVIDER])
    if (!fs.existsSync(path.join(lib, name))) throw new Error(`Arquivo do CUDA ausente: ${name}`)
  const target = path.join(ortDir, CUDA_PROVIDER)
  const source = path.join(lib, CUDA_PROVIDER)
  let link: string | null = null
  try {
    link = fs.readlinkSync(target)
  } catch {
    /* Não é link: arquivo do próprio pacote (modo de desenvolvimento) ou ausente. */
  }
  if (link !== source && !(link === null && fs.existsSync(target))) {
    fs.rmSync(target, { force: true })
    fs.symlinkSync(source, target)
  }
  // RTLD_NOW | RTLD_GLOBAL | RTLD_NODELETE (glibc): a biblioteca fica carregada mesmo
  // depois que o Node recusa o arquivo por não ser um módulo dele.
  const flags = 0x2 | 0x100 | 0x1000
  for (const name of CUDA_LIBS)
    try {
      load({ exports: {} }, path.join(lib, name), flags)
    } catch (error) {
      if (!/self-register/i.test(error instanceof Error ? error.message : String(error))) throw error
    }
  cudaPrepared = dir
}
async function createSession(file: string) {
  if (shared.device === 'cuda') {
    try {
      prepareCuda(shared.cudaDir || '')
      return await ort.InferenceSession.create(file, options('cuda'))
    } catch (error) {
      // Faltou arquivo, driver antigo, placa ocupada: volta sozinho para a placa via WebGPU e avisa.
      shared.cudaError = error instanceof Error ? error.message.slice(0, 300) : String(error)
      shared.device = 'webgpu'
      console.error('[KOMA] CUDA indisponível; o desenho voltou para o WebGPU', { message: shared.cudaError })
    }
  }
  return ort.InferenceSession.create(file, options(shared.device))
}

export function inpaintAvailable() {
  return fs.existsSync(detectorFile()) && fs.existsSync(LAMA)
}

/**
 * Máscara das letras (1 = letra), no tamanho original, lida sob demanda: páginas
 * altas (webtoon) são lidas em janelas quadradas que se sobrepõem, e só as janelas
 * que cobrem as linhas pedidas rodam. Cada pixel das linhas pedidas sai igual ao da
 * página inteira (é a união das mesmas janelas); fora delas pode ficar 0.
 */
export function textMaskReader(image: Buffer) {
  type Page = { data: Buffer; W: number; H: number; mask: Uint8Array; window: number; starts: number[] }
  let page: Promise<Page> | null = null
  const windows = new Map<number, Promise<void>>()
  const read = async (p: Page, start: number) => {
    shared.detector ||= createSession(detectorFile())
    const session = await shared.detector
    const { data, W, mask, window } = p
    const scale = SIDE / Math.max(W, window)
    const w = Math.max(1, Math.round(W * scale))
    const h = Math.max(1, Math.round(window * scale))
    const crop = await sharp(data, { raw: { width: W, height: p.H, channels: 3 } })
      .extract({ left: 0, top: start, width: W, height: window })
      .resize(w, h)
      .raw()
      .toBuffer()
    const input = new Float32Array(3 * SIDE * SIDE)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3
        const j = y * SIDE + x
        input[j] = crop[i] / 255
        input[SIDE * SIDE + j] = crop[i + 1] / 255
        input[2 * SIDE * SIDE + j] = crop[i + 2] / 255
      }
    const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIDE, SIDE]) })
    const seg = output.seg.data as Float32Array
    for (let y = 0; y < window; y++)
      for (let x = 0; x < W; x++) {
        if (seg[Math.min(h - 1, Math.floor(y * scale)) * SIDE + Math.min(w - 1, Math.floor(x * scale))] > 0.3) mask[(start + y) * W + x] = 1
      }
  }
  return async (top = 0, bottom = Infinity): Promise<Uint8Array | null> => {
    if (!inpaintAvailable()) return null
    page ||= (async () => {
      const { data, info } = await sharp(image, { limitInputPixels: 50000000 })
        .rotate()
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true })
      const W = info.width
      const H = info.height
      const window = Math.min(H, Math.max(W, Math.round(W * 1.3)))
      const starts: number[] = []
      for (let next = 0; ; next += Math.max(1, Math.round(window * 0.8))) {
        const start = Math.min(next, H - window)
        starts.push(start)
        if (start + window >= H) break
      }
      return { data, W, H, mask: new Uint8Array(W * H), window, starts }
    })()
    const p = await page
    for (const start of p.starts) {
      if (start >= bottom || start + p.window <= top) continue
      if (!windows.has(start)) windows.set(start, read(p, start))
      await windows.get(start)
    }
    return p.mask
  }
}

/** Máscara das letras da página inteira. */
export function textMask(image: Buffer): Promise<Uint8Array | null> {
  return textMaskReader(image)()
}

/**
 * Reconstrói os pixels marcados de uma região (RGB 0–255, 3 canais) com o LaMa.
 * Só os pixels da máscara mudam; o resto da região fica como estava.
 */
export async function lamaInpaint(data: Float32Array, width: number, height: number, mask: Uint8Array) {
  if (!inpaintAvailable()) return false
  shared.lama ||= createSession(LAMA)
  const session = await shared.lama
  let x1 = width
  let y1 = height
  let x2 = -1
  let y2 = -1
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      const x = i % width
      const y = (i - x) / width
      if (x < x1) x1 = x
      if (x > x2) x2 = x
      if (y < y1) y1 = y
      if (y > y2) y2 = y
    }
  if (x2 < 0) return true
  // Recorte quadrado em volta das letras, com folga para o modelo ver o desenho em volta.
  const side = Math.min(Math.max(width, height), Math.max(x2 - x1, y2 - y1) + 64)
  const cx = Math.round((x1 + x2) / 2)
  const cy = Math.round((y1 + y2) / 2)
  const left = Math.max(0, Math.min(width - Math.min(side, width), cx - Math.round(side / 2)))
  const top = Math.max(0, Math.min(height - Math.min(side, height), cy - Math.round(side / 2)))
  const cw = Math.min(side, width - left)
  const ch = Math.min(side, height - top)
  const sx = cw / LAMA_SIDE
  const sy = ch / LAMA_SIDE
  const image = new Float32Array(3 * LAMA_SIDE * LAMA_SIDE)
  const holes = new Float32Array(LAMA_SIDE * LAMA_SIDE)
  for (let y = 0; y < LAMA_SIDE; y++)
    for (let x = 0; x < LAMA_SIDE; x++) {
      const px = left + Math.min(cw - 1, Math.floor(x * sx))
      const py = top + Math.min(ch - 1, Math.floor(y * sy))
      const i = py * width + px
      const j = y * LAMA_SIDE + x
      for (let c = 0; c < 3; c++) image[c * LAMA_SIDE * LAMA_SIDE + j] = data[i * 3 + c] / 255
      // A máscara reduzida não pode perder letra fina: qualquer pixel marcado no bloco conta.
      let on = 0
      for (let yy = py; yy < Math.min(top + ch, py + Math.ceil(sy)) && !on; yy++)
        for (let xx = px; xx < Math.min(left + cw, px + Math.ceil(sx)) && !on; xx++) if (mask[yy * width + xx]) on = 1
      holes[j] = on
    }
  const output = await session.run({
    image: new ort.Tensor('float32', image, [1, 3, LAMA_SIDE, LAMA_SIDE]),
    mask: new ort.Tensor('float32', holes, [1, 1, LAMA_SIDE, LAMA_SIDE]),
  })
  const result = output[session.outputNames[0]].data as Float32Array
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const i = (top + y) * width + left + x
      if (!mask[i]) continue
      // Bilinear: o recorte de 512 volta ao tamanho original sem degraus.
      const fx = Math.min(LAMA_SIDE - 1, (x + 0.5) / sx - 0.5)
      const fy = Math.min(LAMA_SIDE - 1, (y + 0.5) / sy - 0.5)
      const ax = Math.max(0, Math.floor(fx))
      const ay = Math.max(0, Math.floor(fy))
      const bx = Math.min(LAMA_SIDE - 1, ax + 1)
      const by = Math.min(LAMA_SIDE - 1, ay + 1)
      const tx = Math.max(0, fx - ax)
      const ty = Math.max(0, fy - ay)
      for (let c = 0; c < 3; c++) {
        const plane = c * LAMA_SIDE * LAMA_SIDE
        const v =
          (result[plane + ay * LAMA_SIDE + ax] * (1 - tx) + result[plane + ay * LAMA_SIDE + bx] * tx) * (1 - ty) +
          (result[plane + by * LAMA_SIDE + ax] * (1 - tx) + result[plane + by * LAMA_SIDE + bx] * tx) * ty
        data[i * 3 + c] = Math.max(0, Math.min(255, v))
      }
    }
  return true
}
