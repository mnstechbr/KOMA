import 'server-only'

import fs from 'node:fs'
import { detectTextLines, groupLines, openPixels, readingRows, sameRow, type RawPixels, type TextBox } from './text-detect'
import { isPromoText } from '@/lib/promo-text'
import path from 'node:path'
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'
import {
  assertModelFile,
  resolveIntraOpThreads,
  readPaddleDict,
  decodeRgb,
  decodeYoloOutput,
  nonMaxSuppression,
  mergeSplitBalloons,
  overlapRatio,
  mergeLines,
  mergeTileGroups,
  dedupeDetections,
  roundLine,
  expandBox,
  segmentTextLines,
  prepareRecognitionInput,
  ctcDecodeScored,
  isSpeechLine,
  keptText,
  normalizeOcrText,
  scoreText,
  elapsedMs,
  type Detection,
  type Box,
  type TileDetection,
  DETECT_IMAGE_SIZE,
  OCR_LINE_HEIGHT,
  MIN_LINE_SCORE,
} from './ocr-helpers'

export { dedupeDetections, mergeLines, mergeSplitBalloons, mergeTileGroups } from './ocr-helpers'

const YOLO_MODEL_PATH = resolveModelPath('DETECT_MODEL_PATH', 'yolo.onnx')
const OCR_REC_MODEL_PATH = resolveModelPath('OCR_REC_ONNX_PATH', 'paddleocr_v5_rec.onnx')
const OCR_REC_DICT_PATH = resolveModelPath('OCR_REC_DICT_PATH', 'paddleocr_v5_dict.txt')
const OCR_LATIN_REC_MODEL_PATH = resolveModelPath('OCR_LATIN_REC_ONNX_PATH', 'paddleocr_v5_latin_rec.onnx')
const OCR_LATIN_REC_DICT_PATH = resolveModelPath('OCR_LATIN_REC_DICT_PATH', 'paddleocr_v5_latin_dict.txt')
const OCR_DET_MODEL_PATH = resolveModelPath('OCR_DET_ONNX_PATH', 'paddleocr_v5_det.onnx')
const OCR_KOREAN_REC_MODEL_PATH = resolveModelPath('OCR_KOREAN_REC_ONNX_PATH', 'paddleocr_v5_korean_rec.onnx')
const OCR_KOREAN_REC_DICT_PATH = resolveModelPath('OCR_KOREAN_REC_DICT_PATH', 'paddleocr_v5_korean_dict.txt')

const DETECT_IOU = Number(process.env.DETECT_IOU || 0.6)
const DETECT_MAX_BOXES = Number(process.env.NODE_OCR_DETECT_MAX_BOXES || 96)
const CROP_MARGIN = Number(process.env.DETECT_MARGIN || 12)
// Janelas de uma página alta lidas ao mesmo tempo.
const TILE_TASKS = Number(process.env.NODE_OCR_TILE_TASKS || 2)

let runtimePromise: Promise<NodeOcrRuntime> | null = null

// Onde o OCR roda: 'cpu' (padrão) ou 'webgpu' (placa de vídeo via Vulkan/D3D12,
// sem instalar nada). Mudar a configuração recria os modelos na próxima página.
export type OcrDevice = 'cpu' | 'webgpu'
const ocrConfig: { device: OcrDevice; threads: number } = { device: 'cpu', threads: 0 }
/** Dispositivo em uso pelo OCR (os modelos de apagamento seguem o mesmo). */
export function ocrDevice() { return ocrConfig.device }

export function configureOcr(next: { device: OcrDevice; threads: number }) {
  if (next.device === ocrConfig.device && next.threads === ocrConfig.threads) return
  ocrConfig.device = next.device
  ocrConfig.threads = next.threads
  runtimePromise = null
}

/** Testa se a placa de vídeo roda o detector de balões. Nunca lança erro. */
export async function probeGpu(): Promise<{ available: boolean; ms: number | null }> {
  try {
    const started = performance.now()
    const session = await ort.InferenceSession.create(YOLO_MODEL_PATH, { executionProviders: ['webgpu'], logSeverityLevel: 4 })
    const input = new ort.Tensor('float32', new Float32Array(3 * DETECT_IMAGE_SIZE * DETECT_IMAGE_SIZE).fill(0.5), [1, 3, DETECT_IMAGE_SIZE, DETECT_IMAGE_SIZE])
    await session.run({ [session.inputNames[0]]: input })
    const ms = Math.round(performance.now() - started)
    await session.release().catch(() => undefined)
    return { available: true, ms }
  } catch { return { available: false, ms: null } }
}

export async function extractTextBoxesNode(imageBytes: Buffer, language = 'auto') {
  const runtime = await getRuntime()
  const metadata = await sharp(imageBytes, {limitInputPixels:50000000}).metadata()
  const width = metadata.width!; const height = metadata.height!
  if (height <= width*2.5) return runtime.extractTextBoxes(imageBytes, language)
  // Uma tira vertical inteira reduzida a 640 px torna os balões invisíveis.
  // Janelas sobrepostas mantêm escala e coordenadas no arquivo original.
  const started = performance.now(); const found: Array<Detection & { tile: number }> = []
  const tileHeight = Math.min(height,Math.round(width*1.8)); const overlap = Math.round(width*0.3)
  // A página é decodificada uma vez só; cada janela é um trecho das mesmas linhas
  // de pixels (sem copiar nem gerar PNG), e as janelas são lidas TILE_TASKS por vez.
  const raw = await decodeRgb(imageBytes)
  const tops: number[] = []
  for (let top = 0; ; top += tileHeight - overlap) { tops.push(top); if (top + Math.min(tileHeight, height - top) >= height) break }
  const results: Array<Awaited<ReturnType<NodeOcrRuntime['extractTextBoxes']>>> = new Array(tops.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(TILE_TASKS, tops.length) }, async () => {
    for (let index = next++; index < tops.length; index = next++) {
      const top = tops[index]; const cropHeight = Math.min(tileHeight, height - top)
      const row = raw.width * raw.channels
      results[index] = await runtime.extractTextBoxes({ data: raw.data.subarray(top * row, (top + cropHeight) * row), width: raw.width, height: cropHeight, channels: raw.channels }, language)
    }
  }))
  for (const [tile, result] of results.entries()) {
    const top = tops[tile]
    for (const detection of result.detections) {
      const box:Detection['box'] = [detection.box[0],detection.box[1]+top,detection.box[2],detection.box[3]+top]
      const lines = detection.lines?.map(([x1,y1,x2,y2]):[number,number,number,number]=>[x1,y1+top,x2,y2+top])
      found.push({...detection,box,lines,tile})
    }
  }
  // Um balão na emenda entre duas janelas aparece cortado nas duas: juntar as
  // metades (linhas de ambas) e ler o balão inteiro na imagem original.
  const detections: Detection[] = []
  for (const group of mergeTileGroups(found)) {
    if (group.length === 1) { const single: Detection = { ...group[0] }; delete (single as Partial<TileDetection>).tile; detections.push({ ...single, det_id: detections.length }); continue }
    const merged = mergeLines(group.flatMap((item) => item.lines || [])).map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2, score: 1 }))
    const box: Detection['box'] = [Math.min(...group.map((d) => d.box[0])), Math.min(...group.map((d) => d.box[1])), Math.max(...group.map((d) => d.box[2])), Math.max(...group.map((d) => d.box[3]))]
    const read = merged.length ? await runtime.readLines(raw, width, height, merged, language) : null
    const text = read ? keptText(read.kept) : ''
    const lines = merged.filter((line) => !read?.promo.has(line)).map((line): [number, number, number, number] => [line.x1, line.y1, line.x2, line.y2])
    const longest = [...group].sort((x, y) => y.ocr_text.length - x.ocr_text.length)[0]
    detections.push({ det_id: detections.length, cls_name: group.some((d) => d.cls_name === 'class_0') ? 'class_0' : longest.cls_name, conf: Math.max(...group.map((d) => d.conf)), box, ocr_text: text || longest.ocr_text, ocr_error: '', lines })
  }
  const unique = dedupeDetections(detections)
  return {width,height,detections_count:unique.length,elapsed_ms:elapsedMs(started),timings_ms:{},slowest_stage:'ocr',detections:unique}
}

export async function recognizeImageTextNode(imageBytes: Buffer, timeoutSec = 10, language = 'auto') {
  const runtime = await getRuntime()
  return runtime.recognizeImageText(imageBytes, timeoutSec, language)
}

function getRuntime() {
  // Se a placa de vídeo falhar ao carregar os modelos, o OCR volta para a CPU.
  runtimePromise ||= NodeOcrRuntime.create().catch((error) => {
    if (ocrConfig.device !== 'webgpu') throw error
    console.error('[KOMA] Placa de vídeo indisponível para o OCR; usando a CPU')
    ocrConfig.device = 'cpu'
    return NodeOcrRuntime.create()
  })
  return runtimePromise
}

function resolveModelPath(envKey: string, fileName: string) {
  return process.env[envKey] || path.join(/*turbopackIgnore: true*/ process.cwd(), 'models', fileName)
}

class NodeOcrRuntime {
  private constructor(
    private readonly yoloSession: ort.InferenceSession,
    private readonly recSession: ort.InferenceSession,
    private readonly recDict: string[],
    private readonly latinRecSession: ort.InferenceSession | null,
    private readonly latinRecDict: string[],
    private readonly koreanRecSession: ort.InferenceSession | null,
    private readonly koreanRecDict: string[],
    private readonly detSession: ort.InferenceSession | null
  ) {}

  static async create() {
    assertModelFile(YOLO_MODEL_PATH, 'YOLO')
    assertModelFile(OCR_REC_MODEL_PATH, 'PP-OCR recognition')
    assertModelFile(OCR_REC_DICT_PATH, 'PP-OCR dictionary')

    const sessionOptions: ort.InferenceSession.SessionOptions = {
      // Na placa de vídeo, operações que ela não cobre continuam na CPU.
      executionProviders: ocrConfig.device === 'webgpu' ? ['webgpu', 'cpu'] : ['cpu'],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: ocrConfig.threads > 0 ? ocrConfig.threads : resolveIntraOpThreads(),
      interOpNumThreads: 1,
      logSeverityLevel: 3,
    }
    const yoloSession = await ort.InferenceSession.create(YOLO_MODEL_PATH, sessionOptions)
    const recSession = await ort.InferenceSession.create(OCR_REC_MODEL_PATH, sessionOptions)
    const recDict = readPaddleDict(OCR_REC_DICT_PATH)

    let latinRecSession: ort.InferenceSession | null = null
    let latinRecDict: string[] = []
    if (fs.existsSync(OCR_LATIN_REC_MODEL_PATH) && fs.existsSync(OCR_LATIN_REC_DICT_PATH)) {
      latinRecSession = await ort.InferenceSession.create(OCR_LATIN_REC_MODEL_PATH, sessionOptions)
      latinRecDict = readPaddleDict(OCR_LATIN_REC_DICT_PATH)
    }

    // PP-OCRv5 coreano: reconhece Hangul (o modelo principal não o cobre).
    let koreanRecSession: ort.InferenceSession | null = null
    let koreanRecDict: string[] = []
    if (fs.existsSync(OCR_KOREAN_REC_MODEL_PATH) && fs.existsSync(OCR_KOREAN_REC_DICT_PATH)) {
      assertModelFile(OCR_KOREAN_REC_MODEL_PATH, 'PP-OCR coreano')
      koreanRecSession = await ort.InferenceSession.create(OCR_KOREAN_REC_MODEL_PATH, sessionOptions)
      koreanRecDict = readPaddleDict(OCR_KOREAN_REC_DICT_PATH)
    }

    const detSession = fs.existsSync(OCR_DET_MODEL_PATH) ? await ort.InferenceSession.create(OCR_DET_MODEL_PATH, sessionOptions) : null

    return new NodeOcrRuntime(yoloSession, recSession, recDict, latinRecSession, latinRecDict, koreanRecSession, koreanRecDict, detSession)
  }

  /** Lê as linhas indicadas (coordenadas da própria imagem) e junta o texto. */
  async readLinesFrom(imageBytes: Buffer | RawPixels, width: number, height: number, group: TextBox[], language = 'auto') {
    return keptText((await this.readLines(imageBytes, width, height, group, language)).kept)
  }

  /**
   * Lê cada linha e separa as que são fala das que não são: marca d'água do
   * site, traços soltos e leituras de baixa confiança (efeito sonoro coreano
   * lido como letras latinas). Só as linhas mantidas são apagadas no desenho.
   */
  async readLines(imageBytes: Buffer | RawPixels, width: number, height: number, group: TextBox[], language = 'auto') {
    const latin = /^(en|pt|id|vi|es|fr|de|it|tr)(-|$)/i.test(language)
    const kept: Array<{ line: TextBox; text: string; score: number; row: number }> = []
    const weak: typeof kept = []
    const promo = new Set<TextBox>()
    const order = readingRows(group).flatMap((row, index) => row.map((line) => ({ line, row: index })))
    for (const { line, row } of order) {
      try {
        const crop = await openPixels(imageBytes).extract({ left: Math.floor(line.x1), top: Math.floor(line.y1), width: Math.max(1, Math.min(width - Math.floor(line.x1), Math.ceil(line.x2 - line.x1))), height: Math.max(1, Math.min(height - Math.floor(line.y1), Math.ceil(line.y2 - line.y1))) }).png().toBuffer()
        let { text: raw, score } = await this.recognizeLineScored(crop, language)
        // Letra estilizada (pincel, branca em balão escuro) costuma sair como uma
        // letra só numa linha larga. Nesse caso, lê de novo a linha binarizada e
        // separada em sublinhas, e fica com a leitura mais completa.
        const letters = (raw.match(/[\p{L}\p{N}]/gu) || []).length
        if (latin && line.y2 - line.y1 >= 40 && letters < Math.max(3, (line.x2 - line.x1) / Math.max(1, line.y2 - line.y1) * 1.2)) {
          const retry = await this.readStylizedLine(crop, language)
          if ((retry.match(/[\p{L}]/gu) || []).length > Math.max(letters, 2)) { raw = retry; score = 1 }
        }
        const text = raw.trim()
        // Traços, marcas e caracteres soltos de outro alfabeto não são fala.
        if ((text.match(/[\p{L}\p{N}]/gu) || []).length < 2 && !/[!?]/.test(text)) continue
        if (latin && !/[A-Za-zÀ-ÿ]/.test(text)) continue
        // Em capítulo latino, linha com letras coreanas, japonesas ou chinesas é
        // crédito ou efeito da edição original, não fala.
        if (latin && (text.match(/[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u3400-\u9fff\uac00-\ud7af]/g) || []).length >= 2) continue
        if (isPromoText(text)) { promo.add(line); continue }
        if (latin && score < MIN_LINE_SCORE) { if (score >= 0.35 && (text.match(/[\p{L}]/gu) || []).length >= 3) weak.push({ line, text, score, row }); continue }
        kept.push({ line, text, score, row })
      } catch { /* Linha ilegível não invalida o bloco. */ }
    }
    // Linha de leitura incerta no meio de uma fala lida com segurança ("H OLD!" no
    // fim de "...FOR THE CIRCLE TO"): do mesmo tamanho e colada nas outras, é parte
    // da fala. Sem ela a frase fica pela metade e a palavra continua no desenho.
    if (kept.some((item) => item.score >= 0.8)) {
      const heights = kept.map((item) => item.line.y2 - item.line.y1).sort((a, b) => a - b)
      const median = heights[Math.floor(heights.length / 2)]
      const top = Math.min(...kept.map((item) => item.line.y1)); const bottom = Math.max(...kept.map((item) => item.line.y2))
      for (const item of weak) {
        const height = item.line.y2 - item.line.y1
        if (height >= median * 0.6 && height <= median * 1.6 && item.line.y1 <= bottom + median * 0.5 && item.line.y2 >= top - median * 0.5) kept.push(item)
      }
      kept.sort((a, b) => order.findIndex((entry) => entry.line === a.line) - order.findIndex((entry) => entry.line === b.line))
    }
    return { kept, promo }
  }

  /** Segunda leitura de uma linha estilizada: cinza, contraste máximo e as duas polaridades. */
  private async readStylizedLine(crop: Buffer, language: string) {
    const variants = await Promise.all([
      sharp(crop).greyscale().threshold(150).negate({ alpha: false }).png().toBuffer(),
      sharp(crop).negate({ alpha: false }).png().toBuffer(),
    ])
    let best = ''
    for (const variant of variants) {
      const lines = await segmentTextLines(variant)
      const parts = await Promise.all(lines.slice(0, 4).map((part) => this.recognizeLineScored(part.buffer, language)))
      const text = normalizeOcrText(parts.map((part) => part.text).join(' '))
      const letters = (text.match(/[\p{L}]/gu) || []).length
      // Só leitura confiável e com cara de palavra: efeitos e traços viram lixo aqui.
      const score = parts.reduce((sum, part) => sum + part.score * part.text.length, 0) / Math.max(1, parts.reduce((sum, part) => sum + part.text.length, 0))
      if (letters >= 4 && score >= 0.5 && /[A-Za-zÀ-ÿ]{3,}/.test(text) && letters > (best.match(/[\p{L}]/gu) || []).length) best = text
    }
    return best
  }

  async extractTextBoxes(imageBytes: Buffer | RawPixels, language = 'auto') {
    const started = performance.now()
    const timings: Record<string, number> = {}

    const tDecode = performance.now()
    const raw = Buffer.isBuffer(imageBytes) ? await decodeRgb(imageBytes) : imageBytes
    timings.decode = elapsedMs(tDecode)

    const tDetect = performance.now()
    const boxes = await this.detectBalloons(imageBytes, raw.width, raw.height)
    timings.detect = elapsedMs(tDetect)

    // Linhas de texto (DBNet): leem o balão inteiro mesmo quando a caixa do
    // detector corta as bordas, e acham narração fora de balões.
    const tText = performance.now()
    const lines = this.detSession ? await detectTextLines(this.detSession, imageBytes, raw.width, raw.height) : []
    timings.text = elapsedMs(tText)
    const used = new Set<TextBox>()
    // Fileiras: palavras lado a lado na mesma altura. Só em letra grande (letreiro,
    // grito, letra de pincel), em que o detector parte a linha nos espaços largos;
    // letra pequena lado a lado é de balões encostados (mangá), cada um com sua fala.
    const apart = (a: TextBox, b: TextBox) => Math.min(a.y2 - a.y1, b.y2 - b.y1) < raw.width * 0.07
    const rowOf = new Map(lines.map((line) => [line, [line]]))
    for (const a of lines) for (const b of lines) {
      if (a === b || rowOf.get(a) === rowOf.get(b) || !sameRow(a, b, apart)) continue
      const merged = [...rowOf.get(a)!, ...rowOf.get(b)!]
      for (const line of merged) rowOf.set(line, merged)
    }
    // Recortes das linhas saem dos pixels já decodificados.
    const readLines = (group: TextBox[]) => this.readLines(raw, raw.width, raw.height, group, language)
    const joined = keptText

    const tOcr = performance.now()
    const detections: Detection[] = []
    const crops = boxes.map((box) => expandBox(box, raw.width, raw.height, CROP_MARGIN))
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index]
      const cropBox = expandBox(box, raw.width, raw.height, CROP_MARGIN)
      // Linha pertence ao balão quando a maior parte dela está dentro da caixa,
      // mesmo que o detector tenha cortado a borda do balão.
      const within = (line: TextBox, crop: Box) => Math.max(0, Math.min(line.x2, crop.x2) - Math.max(line.x1, crop.x1)) * Math.max(0, Math.min(line.y2, crop.y2) - Math.max(line.y1, crop.y1))
      const area = (line: TextBox) => Math.max(1, (line.x2 - line.x1) * (line.y2 - line.y1))
      const holds = (crop: Box, line: TextBox) => within(line, crop) / area(line) > 0.5
      // Linha solta: fora de todas as caixas do detector.
      const free = (line: TextBox) => !crops.some((crop) => holds(crop, line))
      // A fileira decide junto com a caixa: palavra solta na mesma fileira ("THIS" ao
      // lado de "TRAP...") entra; fileira quase toda solta (narração que só encosta
      // na caixa) não é deste balão. Palavras de outro balão na mesma altura não contam.
      const candidates = lines.filter((line) => !used.has(line) && holds(cropBox, line))
      const inside = [...new Set(candidates.map((line) => rowOf.get(line)!))].flatMap((row) => {
        const loose = row.filter((line) => !holds(cropBox, line) && free(line))
        const mine = row.filter((line) => holds(cropBox, line))
        const share = mine.reduce((sum, line) => sum + within(line, cropBox), 0) / [...mine, ...loose].reduce((sum, line) => sum + area(line), 0)
        return share >= 0.5 ? [...mine, ...loose] : []
      }).filter((line) => !used.has(line))
      // Linha logo acima ou abaixo das linhas do balão, que saiu da caixa do
      // detector ("ENERGY!" embaixo de "...WITH MERE DEMONIC"), é da mesma fala.
      for (let grew = inside.length > 0; grew;) {
        grew = false
        for (const line of lines) {
          if (used.has(line) || inside.includes(line) || !free(line)) continue
          const near = inside.some((other) => {
            const height = Math.min(other.y2 - other.y1, line.y2 - line.y1)
            const gap = Math.max(other.y1, line.y1) - Math.min(other.y2, line.y2)
            const overlapX = Math.min(other.x2, line.x2) - Math.max(other.x1, line.x1)
            return gap <= height * 0.5 && overlapX >= Math.min(other.x2 - other.x1, line.x2 - line.x1) * 0.5 && Math.max(other.y2 - other.y1, line.y2 - line.y1) <= height * 1.6
          })
          if (near) { inside.push(line); grew = true }
        }
      }
      inside.forEach((line) => used.add(line))
      // Dois balões vizinhos unidos numa caixa só: cada grupo de linhas vira uma fala.
      const groups = inside.length > 1 ? groupLines(inside, apart) : [{ lines: inside }]
      if (groups.length > 1) {
        for (const group of groups) {
          const read = await readLines(group.lines)
          const text = joined(read.kept)
          if (!text) continue
          const own = group.lines.filter((line) => !read.promo.has(line))
          const gx1 = Math.min(...own.map((l) => l.x1)); const gy1 = Math.min(...own.map((l) => l.y1))
          const gx2 = Math.max(...own.map((l) => l.x2)); const gy2 = Math.max(...own.map((l) => l.y2))
          detections.push({ det_id: detections.length, cls_name: 'class_0', conf: box.conf, box: [Math.round(gx1), Math.round(gy1), Math.round(gx2), Math.round(gy2)], ocr_text: text, ocr_error: '', lines: own.map(roundLine) })
        }
        continue
      }
      let text = ''
      let error = ''
      // Linha de marca d'água do site: não entra na fala nem é apagada.
      let own = inside
      try {
        const read = inside.length ? await readLines(inside) : null
        text = read ? joined(read.kept) : ''
        if (read?.promo.size) {
          own = inside.filter((line) => !read.promo.has(line))
          if (!own.length || read.promo.size >= read.kept.length) continue
        }
        // Sem linhas próprias: se o texto da área já pertence a outro balão, é a
        // outra metade do mesmo balão (caixa duplicada) e não vira fala nova.
        // Linhas na caixa que pertencem a uma fileira de fora também contam como texto de outra fala.
        const taken = !inside.length && candidates.length > 0 || !inside.length && lines.some((line) => used.has(line) && overlapRatio([line.x1, line.y1, line.x2, line.y2], [cropBox.x1, cropBox.y1, cropBox.x2, cropBox.y2]) > 0.3)
        if (taken) continue
        if (!text) text = await this.extractTextFromCrop(imageBytes, cropBox, language)
      } catch (err) {
        error = err instanceof Error ? err.message : 'OCR falhou.'
      }

      detections.push({
        det_id: detections.length,
        cls_name: 'class_0',
        conf: box.conf,
        box: [Math.round(box.x1), Math.round(box.y1), Math.round(box.x2), Math.round(box.y2)],
        ocr_text: text,
        ocr_error: error,
        // Sem linhas detectadas: a área central do balão serve de referência para apagar.
        lines: own.length ? own.map(roundLine) : [roundLine({ x1: box.x1 + (box.x2 - box.x1) * 0.15, y1: box.y1 + (box.y2 - box.y1) * 0.15, x2: box.x2 - (box.x2 - box.x1) * 0.15, y2: box.y2 - (box.y2 - box.y1) * 0.15, score: 0 })],
      })
    }

    // Texto fora de balões (narração, legendas sobre a arte).
    for (const group of groupLines(lines.filter((line) => !used.has(line)), apart)) {
      // Só as linhas lidas como fala entram no bloco: traços, efeitos sonoros
      // e marcas d'água ao redor não ampliam a área apagada.
      const read = await readLines(group.lines)
      // Recado do grupo de tradução ("DEAR READERS… HAPPY READING"): a maior parte
      // das linhas é propaganda, e o resto do bloco também é.
      if (isPromoText(joined(read.kept)) || (read.promo.size && read.promo.size >= read.kept.length)) continue
      // O bloco foi juntado por uma linha que não era fala (efeito sonoro coreano
      // entre dois balões): sem ela, as falas voltam a ser separadas.
      const parts = read.kept.length > 1 ? groupLines(read.kept.map((item) => item.line), apart) : [{ lines: read.kept.map((item) => item.line) }]
      for (const part of parts) {
        const kept = read.kept.filter((item) => part.lines.includes(item.line))
        const text = joined(kept)
        const letters = (text.match(/[\p{L}]/gu) || []).length
        // Fala curta e gritada ("NO.", "OK!") também conta.
        if (letters < 3 && !(letters >= 2 && /[!?.]/.test(text) && kept.every((item) => item.score >= 0.8))) continue
        if (isPromoText(text)) continue
        const keptLines = kept.map((item) => item.line)
        const block = { lines: keptLines, score: group.score, x1: Math.min(...keptLines.map((l) => l.x1)), y1: Math.min(...keptLines.map((l) => l.y1)), x2: Math.max(...keptLines.map((l) => l.x2)), y2: Math.max(...keptLines.map((l) => l.y2)) }
        // Letra miúda solta sobre o desenho (marca d'água, assinatura) não é fala.
        const blockLineHeight = [...block.lines.map((l) => l.y2 - l.y1)].sort((a, b) => a - b)[Math.floor(block.lines.length / 2)]
        if (blockLineHeight < raw.width * 0.026) continue
        detections.push({ det_id: detections.length, cls_name: 'text', conf: block.score, box: [Math.round(block.x1), Math.round(block.y1), Math.round(block.x2), Math.round(block.y2)], ocr_text: text, ocr_error: '', lines: block.lines.map(roundLine) })
      }
    }
    timings.ocr = elapsedMs(tOcr)
    detections.splice(0, detections.length, ...dedupeDetections(detections))

    const slowestStage = Object.entries(timings).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
    return {
      width: raw.width,
      height: raw.height,
      detections_count: detections.length,
      elapsed_ms: elapsedMs(started),
      timings_ms: timings,
      slowest_stage: slowestStage,
      detections,
    }
  }

  async recognizeImageText(imageBytes: Buffer, timeoutSec: number, language = 'auto') {
    const started = performance.now()
    const deadline = started + (Math.max(1, timeoutSec) * 1000)
    const lines = await segmentTextLines(imageBytes)
    const recognized: string[] = []
    const errors: string[] = []

    for (const line of lines.slice(0, 20)) {
      if (performance.now() > deadline) {
        errors.push('timeout: usando resultado parcial')
        break
      }
      try {
        const text = await this.recognizeLine(line.buffer, language)
        if (text) recognized.push(text)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'OCR de linha falhou')
      }
    }

    return {
      extracted_text: normalizeOcrText(recognized.join('\n')) || await this.recognizeLine(imageBytes,language),
      elapsed_ms: elapsedMs(started),
      timeout_sec: Math.round(timeoutSec),
      ocr_variant_best: 'node-onnx-recognition',
      ocr_error: errors.join(' | '),
    }
  }

  private async detectBalloons(imageBytes: Buffer | RawPixels, originalWidth: number, originalHeight: number) {
    const input = await openPixels(imageBytes)
      .resize(DETECT_IMAGE_SIZE, DETECT_IMAGE_SIZE, { fit: 'fill' })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer()

    const floatData = new Float32Array(3 * DETECT_IMAGE_SIZE * DETECT_IMAGE_SIZE)
    const plane = DETECT_IMAGE_SIZE * DETECT_IMAGE_SIZE
    for (let y = 0; y < DETECT_IMAGE_SIZE; y += 1) {
      for (let x = 0; x < DETECT_IMAGE_SIZE; x += 1) {
        const src = (y * DETECT_IMAGE_SIZE + x) * 3
        const dst = y * DETECT_IMAGE_SIZE + x
        floatData[dst] = input[src] / 255
        floatData[plane + dst] = input[src + 1] / 255
        floatData[(plane * 2) + dst] = input[src + 2] / 255
      }
    }

    const tensor = new ort.Tensor('float32', floatData, [1, 3, DETECT_IMAGE_SIZE, DETECT_IMAGE_SIZE])
    const feeds: Record<string, ort.Tensor> = { [this.yoloSession.inputNames[0]]: tensor }
    const output = await this.yoloSession.run(feeds)
    const firstOutput = output[this.yoloSession.outputNames[0]]
    const boxes = decodeYoloOutput(firstOutput, originalWidth, originalHeight)
    return mergeSplitBalloons(nonMaxSuppression(boxes, DETECT_IOU)).slice(0, DETECT_MAX_BOXES)
  }

  private async extractTextFromCrop(imageBytes: Buffer | RawPixels, box: Box, language: string) {
    const crop = await openPixels(imageBytes)
      .extract({
        left: Math.max(0, Math.floor(box.x1)),
        top: Math.max(0, Math.floor(box.y1)),
        width: Math.max(1, Math.floor(box.x2 - box.x1)),
        height: Math.max(1, Math.floor(box.y2 - box.y1)),
      })
      .png()
      .toBuffer()

    const lines = await segmentTextLines(crop)
    const recognized: string[] = []
    for (const line of lines.slice(0, 8)) {
      const { text, score } = await this.recognizeLineScored(line.buffer, language)
      if (isSpeechLine(text, score, language)) recognized.push(text.trim())
    }
    const text = normalizeOcrText(recognized.join('\n'))
    if (text) return text
    // Sem linhas separadas: o recorte inteiro, com o mesmo filtro (a borda de um
    // balão cortado lida como "I" não vira fala).
    const whole = await this.recognizeLineScored(crop, language)
    return isSpeechLine(whole.text, whole.score, language) ? whole.text.trim() : ''
  }

  private async recognizeLine(lineBuffer: Buffer, language = 'auto') { return (await this.recognizeLineScored(lineBuffer, language)).text }

  private async recognizeLineScored(lineBuffer: Buffer, language = 'auto') {
    if (/^ko(-|$)/i.test(language)) {
      if (!this.koreanRecSession) throw new Error('Modelo de OCR coreano não instalado.')
      return this.recognizeLineWith(this.koreanRecSession, this.koreanRecDict, lineBuffer)
    }
    if (this.latinRecSession && /^(en|pt|id|vi|es|fr|de|it|tr)(-|$)/i.test(language)) {
      const latin = await this.recognizeLineWith(this.latinRecSession, this.latinRecDict, lineBuffer)
      if (latin.text.trim()) return latin
    }
    const main = await this.recognizeLineWith(this.recSession, this.recDict, lineBuffer)
    if (!this.latinRecSession || scoreText(main.text) >= 10) return main

    const latin = await this.recognizeLineWith(this.latinRecSession, this.latinRecDict, lineBuffer)
    return scoreText(latin.text) > scoreText(main.text) ? latin : main
  }

  supportsKorean() { return Boolean(this.koreanRecSession) }

  private async recognizeLineWith(session: ort.InferenceSession, dict: string[], lineBuffer: Buffer) {
    const { data, width } = await prepareRecognitionInput(lineBuffer)
    const tensor = new ort.Tensor('float32', data, [1, 3, OCR_LINE_HEIGHT, width])
    const output = await session.run({ [session.inputNames[0]]: tensor })
    const logits = output[session.outputNames[0]]
    return ctcDecodeScored(logits, dict)
  }
}
