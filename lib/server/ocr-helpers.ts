// Funções puras e tipos do OCR (decodificação, caixas, linhas, CTC), separados
// de manga-ocr-node.ts sem mudar o comportamento.
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'
import fs from 'node:fs'
import os from 'node:os'
import type { TextBox } from './text-detect'
import { isPromoText } from '@/lib/promo-text'

export const DETECT_IMAGE_SIZE = Number(process.env.NODE_OCR_DETECT_IMAGE_SIZE || 640)
export const DETECT_CONF = Number(process.env.DETECT_CONF || 0.4)
export const DETECT_MIN_BOX_AREA = Number(process.env.DETECT_MIN_BOX_AREA || 400)
export const OCR_LINE_HEIGHT = Number(process.env.NODE_OCR_LINE_HEIGHT || 48)
export const OCR_MAX_LINE_WIDTH = Number(process.env.NODE_OCR_MAX_LINE_WIDTH || 960)
// Confiança mínima de uma linha em alfabeto latino. Abaixo disso a leitura costuma
// ser traço de desenho ou letra coreana lida como latina ("OF / oF", "MOK").
export const MIN_LINE_SCORE = Number(process.env.NODE_OCR_MIN_LINE_SCORE || 0.5)

export type Detection = {
  det_id: number
  cls_name: string
  conf: number
  box: [number, number, number, number]
  ocr_text: string
  ocr_error: string
  /** Linhas de texto detectadas, usadas para apagar o original ao desenhar a tradução. */
  lines?: Array<[number, number, number, number]>
}

export type ImageRaw = {
  data: Buffer
  width: number
  height: number
  channels: number
}

export type Box = {
  x1: number
  y1: number
  x2: number
  y2: number
  conf: number
}

export type LineCrop = {
  buffer: Buffer
  x1: number
  x2: number
  y1: number
  y2: number
}


export function assertModelFile(filePath: string, label: string) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} não encontrado: ${filePath}`)
  const header = fs.readFileSync(filePath, { encoding: null, flag: 'r' }).subarray(0, 48).toString('utf8')
  if (header.startsWith('version https://git-lfs.github.com/spec/v1')) {
    throw new Error(`${label} parece ser ponteiro Git LFS, não modelo real: ${filePath}`)
  }
}

export function resolveIntraOpThreads() {
  const configured = Number(process.env.NODE_OCR_INTRA_OP_THREADS || process.env.OCR_INTRA_OP_THREADS || 0)
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured)
  // Até 4 reconhecimentos rodam juntos: reservar ~1/4 dos núcleos para cada.
  const cpuCount = Math.max(1, Number(process.env.NODE_OCR_CPU_COUNT || 0) || os.availableParallelism())
  return Math.max(1, Math.min(4, Math.floor(cpuCount / 4) || 1))
}

export function readPaddleDict(filePath: string) {
  const entries = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).map((line) => line.replace(/\r$/, ''))
  while (entries.length > 0 && entries[entries.length - 1] === '') entries.pop()
  return ['<blank>', ...entries, ' ']
}

export async function decodeRgb(imageBytes: Buffer): Promise<ImageRaw> {
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

export function decodeYoloOutput(output: ort.Tensor, originalWidth: number, originalHeight: number) {
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

export function nonMaxSuppression(boxes: Box[], iouThreshold: number) {
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

export function overlapRatio(a: number[], b: number[]) {
  const inter = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  return inter / Math.max(1, Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])))
}

/**
 * Remove falas repetidas sobre o mesmo texto (janelas sobrepostas de tiras
 * longas, metades de um balão cortado). Fica a leitura mais completa.
 */
export type TileDetection = Detection & { tile: number }
export const lineArea = (l: [number, number, number, number]) => Math.max(0, l[2] - l[0]) * Math.max(0, l[3] - l[1])
export function lineIou(a: [number, number, number, number], b: [number, number, number, number]) {
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

export function roundLine(line: TextBox): [number, number, number, number] {
  return [Math.round(line.x1), Math.round(line.y1), Math.round(line.x2), Math.round(line.y2)]
}

export function iou(a: Box, b: Box) {
  const x1 = Math.max(a.x1, b.x1)
  const y1 = Math.max(a.y1, b.y1)
  const x2 = Math.min(a.x2, b.x2)
  const y2 = Math.min(a.y2, b.y2)
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1)
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1)
  return intersection / Math.max(1, areaA + areaB - intersection)
}

export function expandBox(box: Box, width: number, height: number, margin: number): Box {
  return {
    x1: clamp(box.x1 - margin, 0, width - 1),
    y1: clamp(box.y1 - margin, 0, height - 1),
    x2: clamp(box.x2 + margin, 1, width),
    y2: clamp(box.y2 + margin, 1, height),
    conf: box.conf,
  }
}

export async function segmentTextLines(cropBuffer: Buffer): Promise<LineCrop[]> {
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

export function lineInkBounds(
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

export function mergeLineRanges(ranges: Array<[number, number]>, gap: number) {
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

export async function prepareRecognitionInput(lineBuffer: Buffer) {
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
export function ctcDecodeScored(output: ort.Tensor, dict: string[]) {
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
export function isSpeechLine(raw: string, score: number, language: string) {
  const text = raw.trim()
  const latin = /^(en|pt|id|vi|es|fr|de|it|tr)(-|$)/i.test(language)
  if ((text.match(/[\p{L}\p{N}]/gu) || []).length < 2 && !/[!?]/.test(text)) return false
  if (latin && !/[A-Za-zÀ-ÿ]/.test(text)) return false
  if (latin && score < MIN_LINE_SCORE) return false
  return !isPromoText(text)
}

/** Texto das linhas lidas: palavras da mesma fileira ficam na mesma linha. */
export function keptText(kept: Array<{ text: string; row: number }>) {
  return normalizeOcrText(kept.map((item, index) => `${index && kept[index - 1].row !== item.row ? '\n' : index ? ' ' : ''}${item.text}`).join(''))
}

export function normalizeOcrText(value: string) {
  return value
    .replace(/\u3000/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function scoreText(value: string) {
  const normalized = normalizeOcrText(value)
  if (!normalized) return 0
  const letters = normalized.replace(/[^\p{L}\p{N}]/gu, '').length
  const replacement = (normalized.match(/[�□]/g) || []).length
  return letters - (replacement * 4)
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function elapsedMs(started: number) {
  return Math.max(0, Math.round(performance.now() - started))
}
