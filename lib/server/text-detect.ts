import 'server-only'
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'

// Detector de linhas de texto PP-OCR (DBNet). Complementa o detector de balões:
// narração, legendas e textos sobre a arte não ficam dentro de um balão.
export type TextBox = { x1: number; y1: number; x2: number; y2: number; score: number }

const LIMIT_SIDE = Number(process.env.NODE_OCR_DET_LIMIT_SIDE || 960)
const BINARY_THRESHOLD = 0.3
const BOX_THRESHOLD = 0.6
const UNCLIP_RATIO = 1.6
// PaddleOCR normaliza a imagem em BGR com média/desvio do ImageNet.
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

export async function detectTextLines(session: ort.InferenceSession, imageBytes: Buffer, width: number, height: number): Promise<TextBox[]> {
  const scale = Math.min(1, LIMIT_SIDE / Math.max(width, height))
  const w = Math.max(32, Math.round((width * scale) / 32) * 32)
  const h = Math.max(32, Math.round((height * scale) / 32) * 32)
  const rgb = await sharp(imageBytes).rotate().resize(w, h, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer()
  const plane = w * h
  const input = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      const value = rgb[i * 3 + (2 - c)] / 255 // BGR
      input[c * plane + i] = (value - MEAN[c]) / STD[c]
    }
  }
  const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, h, w]) })
  const map = output[session.outputNames[0]].data as Float32Array
  const seen = new Uint8Array(plane)
  const boxes: TextBox[] = []
  const queue = new Int32Array(plane)
  for (let start = 0; start < plane; start += 1) {
    if (seen[start] || map[start] <= BINARY_THRESHOLD) continue
    let head = 0; let tail = 0; queue[tail++] = start; seen[start] = 1
    let minX = w; let minY = h; let maxX = 0; let maxY = 0; let sum = 0; let count = 0
    while (head < tail) {
      const index = queue[head++]
      const x = index % w; const y = (index - x) / w
      sum += map[index]; count += 1
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y
      for (const next of [x > 0 ? index - 1 : -1, x < w - 1 ? index + 1 : -1, y > 0 ? index - w : -1, y < h - 1 ? index + w : -1]) {
        if (next >= 0 && !seen[next] && map[next] > BINARY_THRESHOLD) { seen[next] = 1; queue[tail++] = next }
      }
    }
    const bw = maxX - minX + 1; const bh = maxY - minY + 1
    if (bw < 3 || bh < 3 || sum / count < BOX_THRESHOLD) continue
    // "Unclip": o mapa do DBNet encolhe o texto; expandir proporcionalmente.
    const distance = (bw * bh * UNCLIP_RATIO) / (2 * (bw + bh))
    boxes.push({
      x1: Math.max(0, (minX - distance) / (w / width)), y1: Math.max(0, (minY - distance) / (h / height)),
      x2: Math.min(width, (maxX + 1 + distance) / (w / width)), y2: Math.min(height, (maxY + 1 + distance) / (h / height)),
      score: sum / count,
    })
  }
  return boxes
}

/**
 * Palavras da mesma linha que o detector separou: altura em comum e quase
 * encostadas ("I HAD" + "MORE", "AND" + "DIG" com letra grande e espaçada).
 */
export function sameRow(a: TextBox, b: TextBox, apart?: Apart) {
  return beside(a, b) && Math.max(a.x1, b.x1) - Math.min(a.x2, b.x2) <= Math.min(a.y2 - a.y1, b.y2 - b.y1) * 0.5 && !apart?.(a, b)
}

/** Lado a lado na mesma altura. Linhas empilhadas se sobrepõem na vertical (a caixa do detector é mais alta que a letra), mas não lado a lado. */
function beside(a: TextBox, b: TextBox) {
  const shared = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1)
  const overlapX = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)
  const low = Math.min(a.y2 - a.y1, b.y2 - b.y1); const high = Math.max(a.y2 - a.y1, b.y2 - b.y1)
  // Letra do mesmo tamanho: efeito sonoro grande ao lado da fala não é a mesma fileira.
  return high <= low * 1.5 && shared >= low * 0.6 && overlapX <= Math.min(a.x2 - a.x1, b.x2 - b.x1) * 0.3
}

/** Regra extra que separa duas linhas lado a lado (ex.: letra pequena de mangá em balões encostados). */
export type Apart = (a: TextBox, b: TextBox) => boolean

/** Ordem de leitura: linhas da mesma altura formam uma fileira, lida da esquerda para a direita. */
export function readingRows<T extends TextBox>(lines: T[]) {
  const rows: T[][] = []
  for (const line of [...lines].sort((a, b) => (a.y1 + a.y2) - (b.y1 + b.y2))) {
    const row = rows.find((items) => items.every((item) => beside(item, line)))
    if (row) row.push(line)
    else rows.push([line])
  }
  return rows.map((row) => row.sort((a, b) => a.x1 - b.x1)).sort((a, b) => Math.min(...a.map((l) => l.y1)) - Math.min(...b.map((l) => l.y1)))
}

/** Agrupa linhas próximas (mesma coluna, espaçamento de linha, ou lado a lado) em blocos de texto. */
export function groupLines(lines: TextBox[], apart?: Apart) {
  const blocks = lines.map((line) => ({ ...line, lines: [line] }))
  for (let changed = true; changed;) {
    changed = false
    outer: for (let i = 0; i < blocks.length; i += 1) {
      for (let j = i + 1; j < blocks.length; j += 1) {
        const a = blocks[i]; const b = blocks[j]
        const lineHeight = Math.min(...[...a.lines, ...b.lines].map((line) => line.y2 - line.y1))
        const gap = Math.max(a.y1, b.y1) - Math.min(a.y2, b.y2)
        const overlapX = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)
        const stacked = gap <= lineHeight * 0.9 && overlapX >= Math.min(a.x2 - a.x1, b.x2 - b.x1) * 0.3
        if (!stacked && !a.lines.some((p) => b.lines.some((q) => sameRow(p, q, apart)))) continue
        blocks[i] = { x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2), score: Math.max(a.score, b.score), lines: [...a.lines, ...b.lines].sort((p, q) => p.y1 - q.y1) }
        blocks.splice(j, 1)
        changed = true
        break outer
      }
    }
  }
  return blocks
}
