import 'server-only'

import fs from 'node:fs'
import os from 'node:os'
import { detectTextLines, groupLines, readingRows, sameRow, type TextBox } from './text-detect'
import { isPromoText } from '@/lib/promo-text'
import path from 'node:path'
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'

type Detection = {
  det_id: number
  cls_name: string
  conf: number
  box: [number, number, number, number]
  ocr_text: string
  ocr_error: string
  /** Linhas de texto detectadas, usadas para apagar o original ao desenhar a tradução. */
  lines?: Array<[number, number, number, number]>
}

type ImageRaw = {
  data: Buffer
  width: number
  height: number
  channels: number
}

type Box = {
  x1: number
  y1: number
  x2: number
  y2: number
  conf: number
}

type LineCrop = {
  buffer: Buffer
  x1: number
  x2: number
  y1: number
  y2: number
}

const YOLO_MODEL_PATH = resolveModelPath('DETECT_MODEL_PATH', 'yolo.onnx')
const OCR_REC_MODEL_PATH = resolveModelPath('OCR_REC_ONNX_PATH', 'paddleocr_v5_rec.onnx')
const OCR_REC_DICT_PATH = resolveModelPath('OCR_REC_DICT_PATH', 'paddleocr_v5_dict.txt')
const OCR_LATIN_REC_MODEL_PATH = resolveModelPath('OCR_LATIN_REC_ONNX_PATH', 'paddleocr_v5_latin_rec.onnx')
const OCR_LATIN_REC_DICT_PATH = resolveModelPath('OCR_LATIN_REC_DICT_PATH', 'paddleocr_v5_latin_dict.txt')
const OCR_DET_MODEL_PATH = resolveModelPath('OCR_DET_ONNX_PATH', 'paddleocr_v5_det.onnx')
const OCR_KOREAN_REC_MODEL_PATH = resolveModelPath('OCR_KOREAN_REC_ONNX_PATH', 'paddleocr_v5_korean_rec.onnx')
const OCR_KOREAN_REC_DICT_PATH = resolveModelPath('OCR_KOREAN_REC_DICT_PATH', 'paddleocr_v5_korean_dict.txt')

const DETECT_IMAGE_SIZE = Number(process.env.NODE_OCR_DETECT_IMAGE_SIZE || 640)
const DETECT_CONF = Number(process.env.DETECT_CONF || 0.4)
const DETECT_IOU = Number(process.env.DETECT_IOU || 0.6)
const DETECT_MIN_BOX_AREA = Number(process.env.DETECT_MIN_BOX_AREA || 400)
const DETECT_MAX_BOXES = Number(process.env.NODE_OCR_DETECT_MAX_BOXES || 96)
const CROP_MARGIN = Number(process.env.DETECT_MARGIN || 12)
const OCR_LINE_HEIGHT = Number(process.env.NODE_OCR_LINE_HEIGHT || 48)
// Confiança mínima de uma linha em alfabeto latino. Abaixo disso a leitura costuma
// ser traço de desenho ou letra coreana lida como latina ("OF / oF", "MOK").
const MIN_LINE_SCORE = Number(process.env.NODE_OCR_MIN_LINE_SCORE || 0.5)
const OCR_MAX_LINE_WIDTH = Number(process.env.NODE_OCR_MAX_LINE_WIDTH || 960)

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
  for(let top=0, tile=0;top<height;tile++) {
    const cropHeight = Math.min(tileHeight,height-top)
    const crop = await sharp(imageBytes).extract({left:0,top,width,height:cropHeight}).png().toBuffer()
    const result = await runtime.extractTextBoxes(crop,language)
    for (const detection of result.detections) {
      const box:Detection['box'] = [detection.box[0],detection.box[1]+top,detection.box[2],detection.box[3]+top]
      const lines = detection.lines?.map(([x1,y1,x2,y2]):[number,number,number,number]=>[x1,y1+top,x2,y2+top])
      found.push({...detection,box,lines,tile})
    }
    if(top+cropHeight>=height)break
    top+=tileHeight-overlap
  }
  // Um balão na emenda entre duas janelas aparece cortado nas duas: juntar as
  // metades (linhas de ambas) e ler o balão inteiro na imagem original.
  const detections: Detection[] = []
  for (const group of mergeTileGroups(found)) {
    if (group.length === 1) { const single: Detection = { ...group[0] }; delete (single as Partial<TileDetection>).tile; detections.push({ ...single, det_id: detections.length }); continue }
    const merged = mergeLines(group.flatMap((item) => item.lines || [])).map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2, score: 1 }))
    const box: Detection['box'] = [Math.min(...group.map((d) => d.box[0])), Math.min(...group.map((d) => d.box[1])), Math.max(...group.map((d) => d.box[2])), Math.max(...group.map((d) => d.box[3]))]
    const read = merged.length ? await runtime.readLines(imageBytes, width, height, merged, language) : null
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
  async readLinesFrom(imageBytes: Buffer, width: number, height: number, group: TextBox[], language = 'auto') {
    return keptText((await this.readLines(imageBytes, width, height, group, language)).kept)
  }

  /**
   * Lê cada linha e separa as que são fala das que não são: marca d'água do
   * site, traços soltos e leituras de baixa confiança (efeito sonoro coreano
   * lido como letras latinas). Só as linhas mantidas são apagadas no desenho.
   */
  async readLines(imageBytes: Buffer, width: number, height: number, group: TextBox[], language = 'auto') {
    const latin = /^(en|pt|id|vi|es|fr|de|it|tr)(-|$)/i.test(language)
    const kept: Array<{ line: TextBox; text: string; score: number; row: number }> = []
    const weak: typeof kept = []
    const promo = new Set<TextBox>()
    const order = readingRows(group).flatMap((row, index) => row.map((line) => ({ line, row: index })))
    for (const { line, row } of order) {
      try {
        const crop = await sharp(imageBytes, { limitInputPixels: 50000000 }).rotate().extract({ left: Math.floor(line.x1), top: Math.floor(line.y1), width: Math.max(1, Math.min(width - Math.floor(line.x1), Math.ceil(line.x2 - line.x1))), height: Math.max(1, Math.min(height - Math.floor(line.y1), Math.ceil(line.y2 - line.y1))) }).png().toBuffer()
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

  async extractTextBoxes(imageBytes: Buffer, language = 'auto') {
    const started = performance.now()
    const timings: Record<string, number> = {}

    const tDecode = performance.now()
    const raw = await decodeRgb(imageBytes)
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
    const readLines = (group: TextBox[]) => this.readLines(imageBytes, raw.width, raw.height, group, language)
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

  private async detectBalloons(imageBytes: Buffer, originalWidth: number, originalHeight: number) {
    const input = await sharp(imageBytes)
      .rotate()
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

  private async extractTextFromCrop(imageBytes: Buffer, box: Box, language: string) {
    const crop = await sharp(imageBytes)
      .rotate()
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

function assertModelFile(filePath: string, label: string) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} não encontrado: ${filePath}`)
  const header = fs.readFileSync(filePath, { encoding: null, flag: 'r' }).subarray(0, 48).toString('utf8')
  if (header.startsWith('version https://git-lfs.github.com/spec/v1')) {
    throw new Error(`${label} parece ser ponteiro Git LFS, não modelo real: ${filePath}`)
  }
}

function resolveIntraOpThreads() {
  const configured = Number(process.env.NODE_OCR_INTRA_OP_THREADS || process.env.OCR_INTRA_OP_THREADS || 0)
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured)
  // Até 4 reconhecimentos rodam juntos: reservar ~1/4 dos núcleos para cada.
  const cpuCount = Math.max(1, Number(process.env.NODE_OCR_CPU_COUNT || 0) || os.availableParallelism())
  return Math.max(1, Math.min(4, Math.floor(cpuCount / 4) || 1))
}

function readPaddleDict(filePath: string) {
  const entries = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).map((line) => line.replace(/\r$/, ''))
  while (entries.length > 0 && entries[entries.length - 1] === '') entries.pop()
  return ['<blank>', ...entries, ' ']
}

async function decodeRgb(imageBytes: Buffer): Promise<ImageRaw> {
  const { data, info } = await sharp(imageBytes)
    .rotate()
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  }
}

function decodeYoloOutput(output: ort.Tensor, originalWidth: number, originalHeight: number) {
  const dims = output.dims
  const data = output.data as Float32Array
  const rows = Number(dims[1])
  const anchors = Number(dims[2])
  const scaleX = originalWidth / DETECT_IMAGE_SIZE
  const scaleY = originalHeight / DETECT_IMAGE_SIZE
  const boxes: Box[] = []

  for (let anchor = 0; anchor < anchors; anchor += 1) {
    const x = data[anchor]
    const y = data[anchors + anchor]
    const w = data[(anchors * 2) + anchor]
    const h = data[(anchors * 3) + anchor]
    const confidence = data[(anchors * 4) + anchor]
    const classConfidence = rows > 5 ? data[(anchors * 5) + anchor] : 1
    const conf = confidence * (classConfidence > 0.01 ? classConfidence : 1)
    if (conf < DETECT_CONF) continue

    const x1 = clamp((x - (w / 2)) * scaleX, 0, originalWidth)
    const y1 = clamp((y - (h / 2)) * scaleY, 0, originalHeight)
    const x2 = clamp((x + (w / 2)) * scaleX, 0, originalWidth)
    const y2 = clamp((y + (h / 2)) * scaleY, 0, originalHeight)
    const area = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
    if (area < DETECT_MIN_BOX_AREA) continue
    boxes.push({ x1, y1, x2, y2, conf })
  }

  boxes.sort((a, b) => b.conf - a.conf)
  return boxes
}

function nonMaxSuppression(boxes: Box[], iouThreshold: number) {
  const picked: Box[] = []
  for (const box of boxes) {
    if (picked.some((existing) => iou(existing, box) > iouThreshold)) continue
    picked.push(box)
  }
  picked.sort((a, b) => (a.y1 - b.y1) || (a.x1 - b.x1))
  return picked
}

// O detector às vezes corta um balão em duas metades sobrepostas (esquerda/direita
// ou cima/baixo). OCR em cada metade gera frases truncadas que os modelos não
// conseguem traduzir; unir as caixas antes do OCR preserva a fala inteira.
export function mergeSplitBalloons(boxes: Box[]) {
  const merged = boxes.map((box) => ({ ...box }))
  for (let changed = true; changed;) {
    changed = false
    for (let i = 0; i < merged.length && !changed; i += 1) {
      for (let j = i + 1; j < merged.length; j += 1) {
        const a = merged[i]; const b = merged[j]
        const overlapX = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)
        const overlapY = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1)
        if (overlapX <= 0 || overlapY <= 0) continue
        const sideBySide = overlapY >= 0.7 * Math.min(a.y2 - a.y1, b.y2 - b.y1)
        const stacked = overlapX >= 0.7 * Math.min(a.x2 - a.x1, b.x2 - b.x1)
        if (!sideBySide && !stacked) continue
        merged[i] = { x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2), conf: Math.max(a.conf, b.conf) }
        merged.splice(j, 1)
        changed = true
        break
      }
    }
  }
  return merged.sort((a, b) => (a.y1 - b.y1) || (a.x1 - b.x1))
}

function overlapRatio(a: number[], b: number[]) {
  const inter = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  return inter / Math.max(1, Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])))
}

/**
 * Remove falas repetidas sobre o mesmo texto (janelas sobrepostas de tiras
 * longas, metades de um balão cortado). Fica a leitura mais completa.
 */
type TileDetection = Detection & { tile: number }
const lineArea = (l: [number, number, number, number]) => Math.max(0, l[2] - l[0]) * Math.max(0, l[3] - l[1])
function lineIou(a: [number, number, number, number], b: [number, number, number, number]) {
  const inter = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  return inter / Math.max(1, lineArea(a) + lineArea(b) - inter)
}
/** Linhas vistas em duas janelas viram uma só (fica a maior, que não foi cortada). */
export function mergeLines(lines: Array<[number, number, number, number]>) {
  const kept: Array<[number, number, number, number]> = []
  for (const line of [...lines].sort((a, b) => lineArea(b) - lineArea(a))) {
    if (kept.some((other) => lineIou(other, line) > 0.4 || (Math.max(0, Math.min(other[2], line[2]) - Math.max(other[0], line[0])) * Math.max(0, Math.min(other[3], line[3]) - Math.max(other[1], line[1]))) / Math.max(1, lineArea(line)) > 0.7)) continue
    kept.push(line)
  }
  return kept.sort((a, b) => a[1] - b[1] || a[0] - b[0])
}
/** Agrupa detecções de janelas diferentes que são o mesmo balão (caixa ou linha em comum). */
export function mergeTileGroups(found: TileDetection[]) {
  const parent = found.map((_, index) => index)
  const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]))
  for (let i = 0; i < found.length; i++) for (let j = i + 1; j < found.length; j++) {
    const a = found[i]; const b = found[j]
    if (a.tile === b.tile) continue
    const sameBox = overlapRatio(a.box, b.box) > 0.5
    const sameLine = (a.lines || []).some((la) => (b.lines || []).some((lb) => lineIou(la, lb) > 0.4))
    if (sameBox || sameLine) parent[root(j)] = root(i)
  }
  const groups = new Map<number, TileDetection[]>()
  found.forEach((detection, index) => { const key = root(index); groups.set(key, [...(groups.get(key) || []), detection]) })
  return [...groups.values()]
}

export function dedupeDetections<T extends { box: [number, number, number, number]; ocr_text: string; lines?: Array<[number, number, number, number]> }>(detections: T[]) {
  const area = (d: T) => {
    const l = d.lines?.length ? d.lines : [d.box]
    return [Math.min(...l.map((v) => v[0])), Math.min(...l.map((v) => v[1])), Math.max(...l.map((v) => v[2])), Math.max(...l.map((v) => v[3]))]
  }
  const letters = (d: T) => (d.ocr_text.match(/[\p{L}\p{N}]/gu) || []).length
  const kept: T[] = []
  for (const detection of [...detections].filter((d) => !isPromoText(d.ocr_text)).sort((a, b) => letters(b) - letters(a))) {
    if (kept.some((other) => overlapRatio(area(other), area(detection)) > 0.3)) continue
    kept.push(detection)
  }
  return kept.sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]).map((d, index) => ({ ...d, det_id: index }))
}

function roundLine(line: TextBox): [number, number, number, number] {
  return [Math.round(line.x1), Math.round(line.y1), Math.round(line.x2), Math.round(line.y2)]
}

function iou(a: Box, b: Box) {
  const x1 = Math.max(a.x1, b.x1)
  const y1 = Math.max(a.y1, b.y1)
  const x2 = Math.min(a.x2, b.x2)
  const y2 = Math.min(a.y2, b.y2)
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1)
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1)
  return intersection / Math.max(1, areaA + areaB - intersection)
}

function expandBox(box: Box, width: number, height: number, margin: number): Box {
  return {
    x1: clamp(box.x1 - margin, 0, width - 1),
    y1: clamp(box.y1 - margin, 0, height - 1),
    x2: clamp(box.x2 + margin, 1, width),
    y2: clamp(box.y2 + margin, 1, height),
    conf: box.conf,
  }
}

async function segmentTextLines(cropBuffer: Buffer): Promise<LineCrop[]> {
  const { data, info } = await sharp(cropBuffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const width = info.width
  const height = info.height
  if (width <= 0 || height <= 0) return [{ buffer: cropBuffer, x1: 0, x2: width, y1: 0, y2: height }]

  const values = Array.from(data)
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  const darkInk = mean >= 128
  const threshold = darkInk ? Math.max(0, mean - 34) : Math.min(255, mean + 34)
  const rowCounts = new Array<number>(height).fill(0)
  const xStart = Math.max(0, Math.floor(width * 0.10))
  const xEnd = Math.min(width, Math.ceil(width * 0.90))
  const scanWidth = Math.max(1, xEnd - xStart)

  for (let y = 0; y < height; y += 1) {
    let count = 0
    for (let x = xStart; x < xEnd; x += 1) {
      const value = data[(y * width) + x]
      if (darkInk ? value < threshold : value > threshold) count += 1
    }
    rowCounts[y] = count
  }

  const minInk = Math.max(2, Math.floor(scanWidth * 0.018))
  const ranges: Array<[number, number]> = []
  let start = -1
  for (let y = 0; y < height; y += 1) {
    if (rowCounts[y] >= minInk) {
      if (start < 0) start = y
    } else if (start >= 0) {
      if (y - start >= 3) ranges.push([start, y - 1])
      start = -1
    }
  }
  if (start >= 0 && height - start >= 3) ranges.push([start, height - 1])

  const merged = mergeLineRanges(ranges, 2)
    .map(([y1, y2]) => [Math.max(0, y1 - 3), Math.min(height, y2 + 4)] as [number, number])
    .filter(([y1, y2]) => y2 - y1 >= 4)

  const rangeHeights = merged.map(([y1, y2]) => y2 - y1).sort((a, b) => a - b)
  const medianRangeHeight = rangeHeights[Math.floor(rangeHeights.length / 2)] || 0
  const saneMerged = merged.filter(([y1, y2]) => {
    const lineHeight = y2 - y1
    const isBorderBand = (y1 <= 2 || y2 >= height - 2) && medianRangeHeight > 0 && lineHeight > medianRangeHeight * 1.5
    const isTooTall = medianRangeHeight > 0
      ? lineHeight > Math.max(12, medianRangeHeight * 2.8)
      : lineHeight > height * 0.55
    return !isBorderBand && !isTooTall
  })
  const usable = saneMerged.length > 0 ? saneMerged : [[0, height] as [number, number]]
  const lines: LineCrop[] = []
  for (const [y1, y2] of usable) {
    const [x1, x2] = lineInkBounds(data, width, height, y1, y2, darkInk, threshold)
    const buffer = await sharp(cropBuffer)
      .extract({ left: x1, top: y1, width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1) })
      .png()
      .toBuffer()
    lines.push({ buffer, x1, x2, y1, y2 })
  }
  return lines
}

function lineInkBounds(
  data: Buffer,
  width: number,
  height: number,
  y1: number,
  y2: number,
  darkInk: boolean,
  threshold: number
): [number, number] {
  let left = width
  let right = -1
  const minY = clamp(Math.floor(y1), 0, height)
  const maxY = clamp(Math.ceil(y2), minY + 1, height)
  const minX = Math.max(0, Math.floor(width * 0.08))
  const maxX = Math.min(width, Math.ceil(width * 0.92))

  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const value = data[(y * width) + x]
      const isInk = darkInk ? value < threshold : value > threshold
      if (!isInk) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
    }
  }

  if (right < left) return [0, width]

  const pad = Math.max(2, Math.floor(width * 0.015))
  return [
    clamp(left - pad, 0, width - 1),
    clamp(right + pad + 1, 1, width),
  ]
}

function mergeLineRanges(ranges: Array<[number, number]>, gap: number) {
  if (ranges.length === 0) return []
  const merged: Array<[number, number]> = [ranges[0]]
  for (const range of ranges.slice(1)) {
    const prev = merged[merged.length - 1]
    if (range[0] - prev[1] <= gap) {
      prev[1] = range[1]
    } else {
      merged.push([...range])
    }
  }
  return merged
}

async function prepareRecognitionInput(lineBuffer: Buffer) {
  const metadata = await sharp(lineBuffer).metadata()
  const sourceWidth = Math.max(1, metadata.width || OCR_LINE_HEIGHT)
  const sourceHeight = Math.max(1, metadata.height || OCR_LINE_HEIGHT)
  let width = Math.max(16, Math.round((sourceWidth / sourceHeight) * OCR_LINE_HEIGHT))
  width = Math.min(OCR_MAX_LINE_WIDTH, Math.max(16, Math.ceil(width / 8) * 8))

  const raw = await sharp(lineBuffer)
    .resize(width, OCR_LINE_HEIGHT, { fit: 'fill' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer()

  const floatData = new Float32Array(3 * OCR_LINE_HEIGHT * width)
  const plane = OCR_LINE_HEIGHT * width
  for (let y = 0; y < OCR_LINE_HEIGHT; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 3
      const dst = y * width + x
      floatData[dst] = ((raw[src] / 255) - 0.5) / 0.5
      floatData[plane + dst] = ((raw[src + 1] / 255) - 0.5) / 0.5
      floatData[(plane * 2) + dst] = ((raw[src + 2] / 255) - 0.5) / 0.5
    }
  }

  return { data: floatData, width }
}

/** Texto e confiança média (0 a 1) das letras emitidas. */
function ctcDecodeScored(output: ort.Tensor, dict: string[]) {
  const dims = output.dims.map(Number)
  const data = output.data as Float32Array
  const timeSteps = dims.length === 3 ? dims[1] : dims[0]
  const classes = dims.length === 3 ? dims[2] : dims[1]
  const batchOffset = dims.length === 3 ? 0 : 0
  let prev = -1
  let text = ''
  let confidence = 0
  let emitted = 0

  for (let t = 0; t < timeSteps; t += 1) {
    let bestIndex = 0
    let bestValue = -Infinity
    let sum = 0
    const offset = batchOffset + (t * classes)
    for (let c = 0; c < classes; c += 1) {
      const value = data[offset + c]
      sum += value
      if (value > bestValue) {
        bestValue = value
        bestIndex = c
      }
    }
    if (bestIndex !== 0 && bestIndex !== prev) {
      text += dict[bestIndex] ?? ''
      // A saída do PP-OCR já é probabilidade; se não somar ~1, normaliza.
      confidence += Math.abs(sum - 1) < 0.05 ? bestValue : bestValue / Math.max(1e-6, sum)
      emitted += 1
    }
    prev = bestIndex
  }

  return { text: normalizeOcrText(text), score: emitted ? confidence / emitted : 0 }
}

/** Linha que pode ser fala: duas letras ou mais (ou "!"/"?"), alfabeto certo e leitura confiável. */
function isSpeechLine(raw: string, score: number, language: string) {
  const text = raw.trim()
  const latin = /^(en|pt|id|vi|es|fr|de|it|tr)(-|$)/i.test(language)
  if ((text.match(/[\p{L}\p{N}]/gu) || []).length < 2 && !/[!?]/.test(text)) return false
  if (latin && !/[A-Za-zÀ-ÿ]/.test(text)) return false
  if (latin && score < MIN_LINE_SCORE) return false
  return !isPromoText(text)
}

/** Texto das linhas lidas: palavras da mesma fileira ficam na mesma linha. */
function keptText(kept: Array<{ text: string; row: number }>) {
  return normalizeOcrText(kept.map((item, index) => `${index && kept[index - 1].row !== item.row ? '\n' : index ? ' ' : ''}${item.text}`).join(''))
}

function normalizeOcrText(value: string) {
  return value
    .replace(/\u3000/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function scoreText(value: string) {
  const normalized = normalizeOcrText(value)
  if (!normalized) return 0
  const letters = normalized.replace(/[^\p{L}\p{N}]/gu, '').length
  const replacement = (normalized.match(/[�□]/g) || []).length
  return letters - (replacement * 4)
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function elapsedMs(started: number) {
  return Math.max(0, Math.round(performance.now() - started))
}
