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
// Compartilhado entre as cópias do módulo que o Next carrega em cada rota (o
// editor de balões desenha pela rota, com os modelos já carregados pela fila).
const shared = ((
  globalThis as typeof globalThis & {
    __komaInpaint?: { device: 'cpu' | 'webgpu'; detector: Promise<ort.InferenceSession> | null; lama: Promise<ort.InferenceSession> | null }
  }
).__komaInpaint ||= { device: 'cpu', detector: null, lama: null })
export function configureInpaint(next: 'cpu' | 'webgpu') {
  if (next === shared.device) return
  shared.device = next
  shared.detector = null
  shared.lama = null
}
const options = (): ort.InferenceSession.SessionOptions => ({
  executionProviders: shared.device === 'webgpu' ? ['webgpu', 'cpu'] : ['cpu'],
  graphOptimizationLevel: 'all',
  logSeverityLevel: 3,
  // Só para medições (tests/pipeline-benchmark.real.test.ts); o app usa o padrão do onnxruntime.
  ...(Number(process.env.KOMA_INPAINT_THREADS) > 0 ? { intraOpNumThreads: Number(process.env.KOMA_INPAINT_THREADS) } : {}),
})

export function inpaintAvailable() {
  return fs.existsSync(detectorFile()) && fs.existsSync(LAMA)
}

/**
 * Máscara das letras da página inteira (1 = letra), no tamanho original. Páginas
 * altas (webtoon) são lidas em janelas quadradas que se sobrepõem.
 */
export async function textMask(image: Buffer): Promise<Uint8Array | null> {
  if (!inpaintAvailable()) return null
  shared.detector ||= ort.InferenceSession.create(detectorFile(), options())
  const session = await shared.detector
  const { data, info } = await sharp(image, { limitInputPixels: 50000000 })
    .rotate()
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  const mask = new Uint8Array(W * H)
  const window = Math.min(H, Math.max(W, Math.round(W * 1.3)))
  for (let top = 0; ; top += Math.max(1, Math.round(window * 0.8))) {
    const start = Math.min(top, H - window)
    const scale = SIDE / Math.max(W, window)
    const w = Math.max(1, Math.round(W * scale))
    const h = Math.max(1, Math.round(window * scale))
    const crop = await sharp(data, { raw: { width: W, height: H, channels: 3 } })
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
    if (start + window >= H) break
  }
  return mask
}

/**
 * Reconstrói os pixels marcados de uma região (RGB 0–255, 3 canais) com o LaMa.
 * Só os pixels da máscara mudam; o resto da região fica como estava.
 */
export async function lamaInpaint(data: Float32Array, width: number, height: number, mask: Uint8Array) {
  if (!inpaintAvailable()) return false
  shared.lama ||= ort.InferenceSession.create(LAMA, options())
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
