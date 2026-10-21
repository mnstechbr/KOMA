import sharp from 'sharp'
import { isPromoText } from '@/lib/promo-text'

// Gera a página traduzida como imagem: apaga o texto original e escreve a
// tradução encaixada no mesmo espaço. Sem modelos extras: fundo liso recebe a
// cor dominante; fundo desenhado é reconstruído a partir dos pixels vizinhos.
export type Box = [number, number, number, number]
// joined: fala cortada entre duas imagens; as duas desenham o mesmo texto no mesmo lugar.
export interface RenderItem { box: Box; text: string; kind: 'balloon' | 'text'; lines?: Box[]; source?: string; joined?: boolean }
/**
 * Medidas de cada fala desenhada, para a conferência de qualidade:
 * residue = fração das letras originais que continuam iguais depois de apagar;
 * repainted = fração da área do texto reconstruída a partir do redor (borrão);
 * size = tamanho da letra da tradução.
 */
export interface RenderDiagnostic { box: Box; source: string; method: 'balloon' | 'flat' | 'textured' | 'art'; residue: number; repainted: number; size: number; overflow: number; border: number }

const FONT = "'Noto Sans','Liberation Sans','DejaVu Sans',sans-serif"
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const escape = (value: string) => value.replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char]!))

interface Region { left: number; top: number; width: number; height: number; data: Float32Array }
// A página inteira fica numa tela de trabalho: cada balão lê e grava nela, então
// um balão apagado não é desfeito por outro que se sobrepõe a ele.
interface Canvas { width: number; height: number; data: Uint8Array }
function readRegion(canvas: Canvas, left: number, top: number, width: number, height: number): Region {
  const data = new Float32Array(width * height * 3)
  for (let y = 0; y < height; y++) for (let x = 0; x < width * 3; x++) data[y * width * 3 + x] = canvas.data[((top + y) * canvas.width + left) * 3 + x]
  return { left, top, width, height, data }
}
function writeRegion(canvas: Canvas, region: Region) {
  const { left, top, width, height, data } = region
  for (let y = 0; y < height; y++) for (let x = 0; x < width * 3; x++) canvas.data[((top + y) * canvas.width + left) * 3 + x] = Math.max(0, Math.min(255, Math.round(data[y * width * 3 + x])))
}
const luminance = (r: number, g: number, b: number) => r * 0.299 + g * 0.587 + b * 0.114

/** Cor dominante (histograma grosso) e a fração de pixels que ela cobre. */
function dominant(region: Region, inside: (x: number, y: number) => boolean) {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>()
  let total = 0
  for (let y = 0; y < region.height; y += 2) for (let x = 0; x < region.width; x += 2) {
    if (!inside(x, y)) continue
    const i = (y * region.width + x) * 3
    const [r, g, b] = [region.data[i], region.data[i + 1], region.data[i + 2]]
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5)
    const bin = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 }
    bin.n++; bin.r += r; bin.g += g; bin.b += b; bins.set(key, bin); total++
  }
  const best = [...bins.values()].sort((a, b) => b.n - a.n)[0] || { n: 0, r: 255, g: 255, b: 255 }
  return { rgb: [best.r, best.g, best.b].map((value) => value / Math.max(1, best.n)), share: best.n / Math.max(1, total) }
}

function boxBlur(source: Float32Array, width: number, height: number, channels: number, radius: number) {
  const temp = new Float32Array(source.length); const out = new Float32Array(source.length)
  for (let y = 0; y < height; y++) for (let c = 0; c < channels; c++) {
    let sum = 0; let count = 0
    for (let x = -radius; x < width; x++) {
      const add = x + radius; const remove = x - radius - 1
      if (add < width) { sum += source[(y * width + add) * channels + c]; count++ }
      if (remove >= 0) { sum -= source[(y * width + remove) * channels + c]; count-- }
      if (x >= 0) temp[(y * width + x) * channels + c] = sum / count
    }
  }
  for (let x = 0; x < width; x++) for (let c = 0; c < channels; c++) {
    let sum = 0; let count = 0
    for (let y = -radius; y < height; y++) {
      const add = y + radius; const remove = y - radius - 1
      if (add < height) { sum += temp[(add * width + x) * channels + c]; count++ }
      if (remove >= 0) { sum -= temp[(remove * width + x) * channels + c]; count-- }
      if (y >= 0) out[(y * width + x) * channels + c] = sum / count
    }
  }
  return out
}

/**
 * Reconstrução por difusão em camadas: a borda do trecho apagado é preenchida
 * com a média dos vizinhos conhecidos e o preenchimento avança para dentro,
 * até cobrir tudo; uma suavização final esconde as emendas.
 */
// Devolve o controle ao servidor entre etapas longas: o desenho das páginas roda
// no mesmo processo que atende as telas, que não podem ficar travadas.
let lastYield = performance.now()
async function breathe() {
  if (performance.now() - lastYield < 25) return
  await new Promise((resolve) => setImmediate(resolve))
  lastYield = performance.now()
}

async function inpaint(region: Region, mask: Uint8Array) {
  const { width, height, data } = region
  const original = mask.slice()
  let remaining = mask.reduce((sum, value) => sum + value, 0)
  const radius = 4
  for (let pass = 0; remaining > 0 && pass < 400; pass++) {
    // Só a área em volta do que falta preencher (mais a folga do desfoque).
    let minX = width; let minY = height; let maxX = -1; let maxY = -1
    for (let i = 0; i < width * height; i++) if (mask[i]) { const x = i % width; const y = (i - x) / width; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
    if (maxX < 0) break
    const x0 = Math.max(0, minX - radius - 1); const y0 = Math.max(0, minY - radius - 1)
    const w = Math.min(width, maxX + radius + 2) - x0; const h = Math.min(height, maxY + radius + 2) - y0
    const weighted = new Float32Array(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y + y0) * width + x + x0
      if (mask[i]) continue
      const j = (y * w + x) * 4
      weighted[j] = data[i * 3]; weighted[j + 1] = data[i * 3 + 1]; weighted[j + 2] = data[i * 3 + 2]; weighted[j + 3] = 1
    }
    const blurred = boxBlur(weighted, w, h, 4, radius)
    const filled: number[] = []
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y + y0) * width + x + x0; const j = (y * w + x) * 4
      if (!mask[i] || blurred[j + 3] < 0.05) continue
      for (let c = 0; c < 3; c++) data[i * 3 + c] = blurred[j + c] / blurred[j + 3]
      filled.push(i)
    }
    if (!filled.length) break
    for (const i of filled) mask[i] = 0
    remaining -= filled.length
    await breathe()
  }
  const smooth = boxBlur(Float32Array.from(data), width, height, 3, 6)
  for (let i = 0; i < width * height; i++) if (original[i]) for (let c = 0; c < 3; c++) data[i * 3 + c] = smooth[i * 3 + c]
}

// Largura aproximada de cada caractere em Noto Sans Bold (fração do tamanho da fonte).
function charWidth(char: string) {
  if (char === ' ') return 0.26
  if (/[MWÆŒ@]/.test(char)) return 0.9
  if (/[mw]/.test(char)) return 0.86
  if (/[A-ZÀ-ÝÇ]/.test(char)) return 0.68
  if (/[iljIÍÌ.,:;'!|]/.test(char)) return 0.3
  if (/[ftr()\-]/.test(char)) return 0.38
  if (/[0-9]/.test(char)) return 0.57
  return 0.56
}
export function textWidth(text: string, size: number) { return [...text].reduce((sum, char) => sum + charWidth(char), 0) * size }

/**
 * Encaixa o texto: diminui a fonte antes de quebrar palavras; só quebra palavra
 * (com hífen) se nem no menor tamanho couber. "room" diz a largura livre numa
 * faixa vertical (distâncias a partir do centro do texto): num balão oval, as
 * linhas de cima e de baixo têm menos espaço que as do meio.
 */
export function fitText(text: string, width: number, height: number, maxSize = 48, room?: (top: number, bottom: number) => number) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const wrap = (size: number, breakWords: boolean, limit = width) => {
    const lines: string[] = []
    let current = ''
    for (let word of words) {
      while (breakWords && textWidth(word, size) > limit && word.length > 3) {
        let cut = word.length - 1
        while (cut > 2 && textWidth(`${word.slice(0, cut)}-`, size) > limit) cut--
        if (current) { lines.push(current); current = '' }
        lines.push(`${word.slice(0, cut)}-`); word = word.slice(cut)
      }
      const candidate = current ? `${current} ${word}` : word
      if (!current || textWidth(candidate, size) <= limit) current = candidate
      else { lines.push(current); current = word }
    }
    if (current) lines.push(current)
    return lines
  }
  const fits = (lines: string[], size: number, lineHeight: number) => {
    if (lines.length * lineHeight > height) return false
    const start = -(lines.length * lineHeight) / 2
    // Folga da borda do balão: letra encostada no contorno parece vazar.
    return lines.every((line, i) => textWidth(line, size) <= (room ? Math.min(width, room(start + i * lineHeight, start + (i + 1) * lineHeight) - size * 0.1) : width))
  }
  for (let size = Math.max(10, Math.min(maxSize, Math.floor(height))); size >= 10; size -= 1) {
    const lineHeight = size * 1.15
    // Quebrar mais cedo deixa o bloco mais estreito e alto, o que cabe melhor num balão oval.
    for (const share of room ? [1, 0.9, 0.8, 0.7, 0.6, 0.5] : [1]) {
      const lines = wrap(size, false, width * share)
      if (fits(lines, size, lineHeight)) return { size, lineHeight, lines }
    }
  }
  const size = 10
  // Nem no menor tamanho coube: quem chamou pode tentar outra área.
  return { size, lineHeight: size * 1.15, lines: wrap(size, true), overflow: true }
}

/**
 * Miolo de um balão de fundo liso: a área da cor do fundo ligada às linhas de
 * texto. Se ela vaza até a borda da região, não há contorno fechado (texto solto
 * sobre a página) e devolve null. "holes" são as letras dentro do balão.
 * "clip" limita a busca a um retângulo (balão encostado em outro balão).
 */
export function balloonInterior(region: Region, rgb: number[], seed: (x: number, y: number) => boolean, clip?: Box) {
  const { width, height, data } = region
  const size = width * height
  const [cx1, cy1, cx2, cy2] = clip || [0, 0, width, height]
  const near = (i: number) => {
    const x = i % width; const y = (i - x) / width
    return x >= cx1 && x < cx2 && y >= cy1 && y < cy2 && Math.abs(data[i * 3] - rgb[0]) + Math.abs(data[i * 3 + 1] - rgb[1]) + Math.abs(data[i * 3 + 2] - rgb[2]) <= 60
  }
  const inside = new Uint8Array(size); const stack: number[] = []
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = y * width + x; if (seed(x, y) && near(i)) { inside[i] = 1; stack.push(i) } }
  if (!stack.length) return null
  while (stack.length) {
    const i = stack.pop()!; const x = i % width; const y = (i - x) / width
    for (const next of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) if (next >= 0 && !inside[next] && near(next)) { inside[next] = 1; stack.push(next) }
  }
  let leak = 0
  for (let x = 0; x < width; x++) leak += inside[x] + inside[(height - 1) * width + x]
  for (let y = 0; y < height; y++) leak += inside[y * width] + inside[y * width + width - 1]
  if (leak > (width + height) * 2 * 0.02) return null
  if (clip) {
    // Encostar no retângulo só é aceitável na passagem estreita para o balão vizinho.
    let edge = 0
    for (let x = cx1; x < cx2; x++) edge += inside[cy1 * width + x] + inside[(cy2 - 1) * width + x]
    for (let y = cy1; y < cy2; y++) edge += inside[y * width + cx1] + inside[y * width + cx2 - 1]
    if (edge > ((cx2 - cx1) + (cy2 - cy1)) * 2 * 0.12) return null
  }
  // Fora do balão: tudo que não é miolo e se alcança a partir da borda (ou do retângulo).
  const outside = new Uint8Array(size)
  const push = (i: number) => { if (!inside[i] && !outside[i]) { outside[i] = 1; stack.push(i) } }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (x < cx1 || x >= cx2 || y < cy1 || y >= cy2) push(y * width + x)
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x) }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1) }
  while (stack.length) {
    const i = stack.pop()!; const x = i % width; const y = (i - x) / width
    for (const next of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) if (next >= 0) push(next)
  }
  const holes = new Uint8Array(size)
  let x1 = width; let y1 = height; let x2 = 0; let y2 = 0; let area = 0
  for (let i = 0; i < size; i++) {
    if (!outside[i] && !inside[i]) holes[i] = 1
    if (inside[i]) { const x = i % width; const y = (i - x) / width; area++; if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y }
  }
  // Miolo minúsculo não é balão (fundo liso entre letras grandes).
  if (area < 400 || x2 - x1 < 30 || y2 - y1 < 20) return null
  return { holes, outside, x1, y1, x2: x2 + 1, y2: y2 + 1, width, height }
}

/** Fração de letras maiúsculas (-1 quando quase não há letras). */
function upperShare(text: string) {
  const letters = text.replace(/[^A-Za-z]/g, '')
  return letters.length > 3 ? letters.replace(/[^A-Z]/g, '').length / letters.length : -1
}

const distance = (data: Float32Array, i: number, rgb: number[]) => Math.abs(data[i * 3] - rgb[0]) + Math.abs(data[i * 3 + 1] - rgb[1]) + Math.abs(data[i * 3 + 2] - rgb[2])

/**
 * Cor das letras originais: a cor frequente dentro das linhas de texto e rara em
 * volta delas. Devolve null quando não há uma cor que se destaque.
 */
export function textColor(region: Region, inLines: (x: number, y: number) => boolean, around: (x: number, y: number) => boolean) {
  const lines = new Map<number, { n: number; r: number; g: number; b: number }>(); const ring = new Map<number, number>()
  let totalLines = 0; let totalRing = 0
  for (let y = 0; y < region.height; y += 2) for (let x = 0; x < region.width; x += 2) {
    const i = (y * region.width + x) * 3
    const [r, g, b] = [region.data[i], region.data[i + 1], region.data[i + 2]]
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5)
    if (inLines(x, y)) { const bin = lines.get(key) || { n: 0, r: 0, g: 0, b: 0 }; bin.n++; bin.r += r; bin.g += g; bin.b += b; lines.set(key, bin); totalLines++ }
    else if (around(x, y)) { ring.set(key, (ring.get(key) || 0) + 1); totalRing++ }
  }
  let best: { n: number; r: number; g: number; b: number } | null = null
  for (const [key, bin] of lines) {
    const share = bin.n / Math.max(1, totalLines)
    const outside = (ring.get(key) || 0) / Math.max(1, totalRing)
    if (share >= 0.03 && outside < share * 0.3 && (!best || bin.n > best.n)) best = bin
  }
  return best ? [best.r / best.n, best.g / best.n, best.b / best.n] : null
}

function paintMask(region: Region, mask: Uint8Array, rgb: number[]) {
  for (let i = 0; i < mask.length; i++) if (mask[i]) { region.data[i * 3] = rgb[0]; region.data[i * 3 + 1] = rgb[1]; region.data[i * 3 + 2] = rgb[2] }
}

/** Engrossa a máscara em "reach" pixels (contorno e brilho em volta das letras). */
function dilate(mask: Uint8Array, width: number, height: number, reach: number, allowed: (x: number, y: number) => boolean = () => true) {
  const grown = mask.slice()
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!mask[y * width + x]) continue
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const xx = x + dx; const yy = y + dy
      if (xx >= 0 && yy >= 0 && xx < width && yy < height && allowed(xx, yy)) grown[yy * width + xx] = 1
    }
  }
  return grown
}

/**
 * Miolo de um balão com textura (escuro listrado, granulado): a imagem desfocada
 * apaga a textura e o contorno fechado aparece. Só serve para posicionar o texto
 * e limitar o apagamento; a textura em si continua.
 */
function texturedInterior(region: Region, inErase: (x: number, y: number) => boolean, inLines: (x: number, y: number) => boolean, lineHeight: number) {
  const soft = { ...region, data: boxBlur(region.data, region.width, region.height, 3, Math.max(2, Math.round(lineHeight * 0.12))) }
  const ground = dominant(soft, (x, y) => inErase(x, y) && !inLines(x, y))
  if (ground.share < 0.4) return null
  const found = balloonInterior(soft, ground.rgb, inLines)
  return found ? { ...found, rgb: ground.rgb } : null
}

/**
 * Modelos de apagamento (opcionais): "mask" devolve a máscara das letras da página
 * inteira (1 = letra); "inpaint" reconstrói os pixels marcados de uma região.
 */
export interface EraseModels { mask: () => Promise<Uint8Array | null>; inpaint: (data: Float32Array, width: number, height: number, mask: Uint8Array) => Promise<boolean> }

export async function renderTranslatedPage(original: Buffer, items: RenderItem[], diagnostics?: RenderDiagnostic[], models?: EraseModels) {
  const image = sharp(original, { limitInputPixels: 50000000 }).rotate()
  const decoded = await image.clone().removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  const canvas: Canvas = { width: decoded.info.width, height: decoded.info.height, data: new Uint8Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.length) }
  const W = canvas.width; const H = canvas.height
  const texts: string[] = []
  // Caixa alta pela maioria: o OCR às vezes lê "troUBlEsoME" num texto todo em
  // maiúsculas. Se a página é quase toda em maiúsculas, todas as falas também são.
  const shares = items.map((item) => upperShare(item.source || item.text)).filter((share) => share >= 0).sort((a, b) => a - b)
  // Troca de caixa no meio da palavra ("HAvE", "TrEATED") é letra maiúscula estilizada lida errado.
  const words = items.flatMap((item) => (item.source || '').split(/[^A-Za-z]+/).filter((word) => word.length > 2))
  const mixed = words.filter((word) => /[a-z][A-Z]/.test(word) && !/^Mc[A-Z]/.test(word)).length
  const pageUppercase = shares.length > 0 && (shares[Math.floor(shares.length / 2)] >= 0.6 || mixed >= Math.max(2, words.length * 0.06))
  // Balões maiores primeiro: um pedaço solto dentro de um balão já desenhado
  // (palavra colorida lida à parte) foi apagado com ele e já está na tradução dele.
  const drawn: Array<{ box: [number, number, number, number]; source: string }> = []
  const wordsOf = (text: string) => (text.toUpperCase().match(/[A-Z]{2,}/g) || [])
  const area = (box: number[]) => Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1])
  for (const raw of [...items].sort((a, b) => area(b.box) - area(a.box))) {
    const cx = (raw.box[0] + raw.box[2]) / 2; const cy = (raw.box[1] + raw.box[3]) / 2
    // Só pula se for mesmo um pedaço da fala do balão já desenhado (as palavras
    // dele estão na leitura do balão); fala própria num balão encostado é desenhada.
    if (drawn.some(({ box: b, source }) => {
      if (!(cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3] && area(raw.box) < area(b) * 0.25)) return false
      const mine = wordsOf(raw.source || raw.text); const theirs = new Set(wordsOf(source))
      return !mine.length || mine.filter((word) => theirs.has(word)).length >= mine.length * 0.6
    })) continue
    await breathe()
    // Restos de OCR antigo ("—", "_", caractere CJK solto) não são desenhados.
    const text = raw.text.split('\n').map((line) => line.trim()).filter((line) => /[A-Za-zÀ-ÿ0-9]/.test(line)).map((line) => line.replace(/^[⺀-鿿]\s*|\s*[⺀-鿿]$/g, '')).join(' ').trim()
    // Sem as linhas do texto original não há como apagá-lo com precisão. Propaganda
    // se reconhece pelo original: a tradução tem "com" e "site" como palavras comuns.
    if (!text || !raw.lines?.length || isPromoText(raw.source || '')) continue
    const lines = raw.lines
    const tx1 = Math.min(...lines.map((l) => l[0])); const ty1 = Math.min(...lines.map((l) => l[1]))
    const tx2 = Math.max(...lines.map((l) => l[2])); const ty2 = Math.max(...lines.map((l) => l[3]))
    const lineHeight = [...lines.map((l) => l[3] - l[1])].sort((a, b) => a - b)[Math.floor(lines.length / 2)]
    // Letra miúda solta sobre o desenho é marca d'água/assinatura: não redesenhar.
    if (raw.kind === 'text' && lineHeight < W * 0.026) continue
    const pad = Math.max(4, Math.round(lineHeight * 0.45))
    const ex1 = clamp(Math.floor(tx1 - pad), 0, W - 1); const ey1 = clamp(Math.floor(ty1 - pad), 0, H - 1)
    const ex2 = clamp(Math.ceil(tx2 + pad), ex1 + 1, W); const ey2 = clamp(Math.ceil(ty2 + pad), ey1 + 1, H)
    // Balão: a área lida inclui o balão inteiro, para achar o contorno dele. Se o
    // detector cortou o balão, a área cresce até achar o contorno fechado.
    const [bx1, by1, bx2, by2] = raw.box
    const ox1 = raw.kind === 'balloon' ? Math.min(ex1, bx1) : ex1; const oy1 = raw.kind === 'balloon' ? Math.min(ey1, by1) : ey1
    const ox2 = raw.kind === 'balloon' ? Math.max(ex2, bx2) : ex2; const oy2 = raw.kind === 'balloon' ? Math.max(ey2, by2) : ey2
    const linePad = Math.max(3, Math.round(lineHeight * 0.15))
    const span = Math.max(ox2 - ox1, oy2 - oy1)
    const margins = [24, Math.round(Math.max(60, span * 0.25)), Math.round(Math.max(120, span * 0.5))]
    let left = 0; let top = 0; let region = readRegion(canvas, 0, 0, 1, 1)
    let background = { rgb: [255, 255, 255], share: 0 }
    let interior: ReturnType<typeof balloonInterior> = null
    let weak = false
    let spiky = false
    type Test = (x: number, y: number) => boolean
    const never: Test = () => false
    let inErase = never
    let inLinePadded = never
    let inLine = never
    for (const margin of margins) {
      left = clamp(Math.floor(ox1) - margin, 0, W - 1); top = clamp(Math.floor(oy1) - margin, 0, H - 1)
      const right = clamp(Math.ceil(ox2) + margin, left + 1, W); const bottom = clamp(Math.ceil(oy2) + margin, top + 1, H)
      region = readRegion(canvas, left, top, right - left, bottom - top)
      const l = left; const t = top
      inErase = (x, y) => x + l >= ex1 && x + l < ex2 && y + t >= ey1 && y + t < ey2
      inLinePadded = (x, y) => lines.some(([x1, y1, x2, y2]) => x + l >= x1 - linePad && x + l <= x2 + linePad && y + t >= y1 - linePad && y + t <= y2 + linePad)
      inLine = (x, y) => lines.some(([x1, y1, x2, y2]) => x + l >= x1 && x + l <= x2 && y + t >= y1 && y + t <= y2)
      // Cor do fundo: entre as linhas e na folga em volta delas, onde não há letras.
      background = dominant(region, (x, y) => inErase(x, y) && !inLine(x, y))
      spiky = false
      // Balão branco alto e estreito com borda de espinhos densos: a folga em volta
      // das linhas pega mais espinho (preto) que miolo. Se entre as letras o fundo
      // é claro, o balão é claro.
      if (luminance(background.rgb[0], background.rgb[1], background.rgb[2]) < 80) {
        const light = [dominant(region, (x, y) => inLinePadded(x, y) && !inLine(x, y)), dominant(region, inLine)]
          .find((candidate) => candidate.share > 0.5 && luminance(candidate.rgb[0], candidate.rgb[1], candidate.rgb[2]) > 200)
        // As letras precisam ser pretas (preto no branco); letra clara com brilho colorido em fundo escuro não é esse caso.
        let dark = 0; let total = 0
        for (let y = 0; y < region.height; y += 2) for (let x = 0; x < region.width; x += 2) if (inLine(x, y)) { total++; const i = (y * region.width + x) * 3; if (luminance(region.data[i], region.data[i + 1], region.data[i + 2]) < 70 && Math.max(region.data[i], region.data[i + 1], region.data[i + 2]) - Math.min(region.data[i], region.data[i + 1], region.data[i + 2]) < 40) dark++ }
        if (light && dark > total * 0.08) { background = light; spiky = true }
      }
      // Fundo liso fechado por um contorno (balão): apagar tudo o que está dentro,
      // inclusive letras que o detector de linhas não pegou.
      // Balão com letra enorme e contornada ("YO!"): o fundo claro do balão é minoria
      // perto das linhas, mas o contorno fechado ainda se acha.
      const light = luminance(background.rgb[0], background.rgb[1], background.rgb[2]) > 200
      weak = background.share <= 0.5 && raw.kind === 'balloon' && light && background.share > 0.25
      interior = background.share > 0.5 || weak ? balloonInterior(region, background.rgb, inLinePadded) : null
      if (weak && interior) {
        // Nesse caso o miolo só vale se as linhas estiverem quase inteiras dentro dele
        // (balão em degradê com letra brilhante dá um miolo parcial, que deixaria letras).
        const found = interior; let total = 0; let out = 0
        for (let y = 0; y < region.height; y += 2) for (let x = 0; x < region.width; x += 2) if (inLine(x, y)) { total++; if (found.outside[y * region.width + x]) out++ }
        if (out > total * 0.1) interior = null
      }
      if (interior || raw.kind !== 'balloon' || background.share <= 0.5) break
      await breathe()
    }
    // Balão encostado em outro: o miolo achado atravessa para o vizinho (tem as
    // linhas de outra fala dentro). Refazer limitado à caixa deste balão.
    const others = items.filter((other) => other !== raw).flatMap((other) => other.lines || [])
    const crosses = (found: NonNullable<typeof interior>, l: number, t: number) => others.some(([x1, y1, x2, y2]) => {
      const x = Math.round((x1 + x2) / 2 - l); const y = Math.round((y1 + y2) / 2 - t)
      return x >= 0 && y >= 0 && x < found.width && y < found.height && !found.outside[y * found.width + x]
    })
    if (interior && raw.kind === 'balloon') {
      const merged = crosses(interior, left, top)
      const clip: Box = [clamp(Math.floor(Math.min(bx1, tx1) - left), 0, region.width - 1), clamp(Math.floor(Math.min(by1, ty1) - top), 0, region.height - 1), clamp(Math.ceil(Math.max(bx2, tx2) - left), 1, region.width), clamp(Math.ceil(Math.max(by2, ty2) - top), 1, region.height)]
      if (merged) interior = balloonInterior(region, background.rgb, inLinePadded, clip)
    }
    // Miolo que não cobre as linhas lidas (letras com brilho dividem o balão escuro
    // em pedaços) não serve: o texto sairia pequeno num canto e sobrariam letras.
    const covers = (found: NonNullable<typeof interior>, l: number, t: number) => {
      const slack = lineHeight * 0.6
      return !(l + found.x1 > tx1 + slack || l + found.x2 < tx2 - slack || t + found.y1 > ty1 + slack || t + found.y2 < ty2 - slack)
    }
    if (interior && !covers(interior, left, top)) interior = null
    const { width, height } = region
    const before = region.data.slice()
    const flat = background.share > 0.5
    // Linhas do balão estendidas até a borda dele: palavra que o detector de linhas
    // perdeu na mesma altura ("…EARN HIS TRUST") também é apagada.
    const reachX = lineHeight * 1.5
    const inRow = (x: number, y: number) => raw.kind === 'balloon' && x + left > Math.min(bx1, tx1) - reachX && x + left < Math.max(bx2, tx2) + reachX && lines.some(([, y1, , y2]) => y + top >= y1 - linePad && y + top <= y2 + linePad)
    const inArea = (x: number, y: number) => inErase(x, y) || inRow(x, y)
    let mask = new Uint8Array(width * height)
    let textured = !flat && !interior
    if (interior) {
      for (let i = 0; i < width * height; i++) if (interior.holes[i]) mask[i] = 1
    } else if (flat) {
      // Fundo liso: apagar só as letras. Um traço que sai da área do texto é
      // contorno do balão ou desenho vizinho e fica intacto.
      const ink = new Uint8Array(width * height)
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (!inArea(x, y)) continue
        const i = y * width + x
        if (distance(region.data, i, background.rgb) > 45) ink[i] = 1
      }
      const seen = new Uint8Array(width * height); const stack: number[] = []
      const rejected = new Uint8Array(width * height); const specks: number[][] = []
      for (let start = 0; start < width * height; start++) {
        if (!ink[start] || seen[start]) continue
        // Letra: a maior parte dela está nas linhas do texto (o brilho em volta
        // de letras grandes vaza um pouco). Contorno de balão ou desenho fica de fora.
        const component: number[] = []; let within = 0; let touchesEdge = false; let rowOnly = true
        let minY = height; let maxY = 0; let minX = width; let maxX = 0
        stack.push(start); seen[start] = 1
        while (stack.length) {
          const i = stack.pop()!; component.push(i)
          const x = i % width; const y = (i - x) / width
          if (inLinePadded(x, y)) within++
          if (!inRow(x, y)) rowOnly = false
          if (y < minY) minY = y; if (y > maxY) maxY = y; if (x < minX) minX = x; if (x > maxX) maxX = x
          // A borda da própria imagem não conta: a letra cortada ao meio entre duas imagens é letra.
          const out = (xx: number, yy: number) => xx + left >= 0 && yy + top >= 0 && xx + left < W && yy + top < H && !inArea(xx, yy)
          if (out(x - 1, y) || out(x + 1, y) || out(x, y - 1) || out(x, y + 1)) touchesEdge = true
          for (const next of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) if (next >= 0 && ink[next] && !seen[next]) { seen[next] = 1; stack.push(next) }
        }
        const share = within / component.length
        // Traço fino que sai da área do texto é contorno do balão, mesmo quando passa
        // quase todo por dentro das linhas (a nuvem do "YES!" encostada nas letras).
        const thin = component.length / Math.max(maxX - minX + 1, maxY - minY + 1) <= Math.max(3, lineHeight * 0.18)
        const letter = share >= 0.6 && (!touchesEdge || (share >= 0.85 && !thin))
        // Palavra perdida na mesma linha: inteira dentro da faixa, do tamanho de uma
        // letra e logo ao lado do texto lido. Pedaços finos do contorno não contam.
        const tall = maxY - minY + 1
        const beside = lines.some(([x1, y1, x2, y2]) => minY + top <= y2 && maxY + top >= y1 && Math.min(Math.abs(minX + left - x2), Math.abs(x1 - (maxX + left))) <= lineHeight)
        const missed = rowOnly && !touchesEdge && tall >= lineHeight * 0.4 && tall <= lineHeight * 1.4 && component.length >= tall * 2 && beside
        if (!letter && !missed) { if (touchesEdge && thin) for (const i of component) rejected[i] = 1 }
        else if (component.length < lineHeight * lineHeight * 0.03) specks.push(component)
        else for (const i of component) mask[i] = 1
      }
      // Pedacinho colado num traço recusado é o contorno do balão partido pelo
      // antisserrilhado, não pontuação: apagá-lo abria buracos brancos na borda.
      const nearBorder = dilate(rejected, width, height, Math.max(4, Math.round(lineHeight * 0.12)))
      for (const component of specks) if (!component.some((i) => nearBorder[i])) for (const i of component) mask[i] = 1
      mask = dilate(mask, width, height, Math.max(2, Math.round(lineHeight * 0.06)), inArea)
      // Letra encostada em listras ou textura (brilho sobre fundo riscado): se
      // ainda sobra tinta dentro das linhas, o fundo não é tão liso quanto parecia.
      let lineCount = 0; let leftover = 0
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (!inLinePadded(x, y)) continue
        const i = y * width + x
        lineCount++
        if (!mask[i] && !nearBorder[i] && distance(region.data, i, background.rgb) > 60) leftover++
      }
      if (leftover > lineCount * 0.06) textured = true
    }
    if (interior) {
      // O miolo inteiro vira a cor do balão: letras e o cinza claro do
      // antisserrilhado em volta delas, que senão ficaria como "fantasma".
      for (let i = 0; i < width * height; i++) {
        if (interior.outside[i]) continue
        region.data[i * 3] = background.rgb[0]; region.data[i * 3 + 1] = background.rgb[1]; region.data[i * 3 + 2] = background.rgb[2]
      }
      // Letras com brilho encostadas na borda ou no desenho do balão escapam do
      // miolo: se ainda sobra tinta nas linhas, elas são apagadas como texto sobre desenho.
      // Balão claro com letra enorme ("YO!"): a linha passa da borda do balão, e lá
      // fora não conta o que tem a cor do próprio fundo de fora.
      const found = interior
      const outsideGround = dominant(region, (x, y) => inLinePadded(x, y) && found.outside[y * width + x] === 1)
      let lineCount = 0; let leftover = 0
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (!inLinePadded(x, y)) continue
        const i = y * width + x
        // Balão de espinhos densos: fora do miolo só há espinho, não letra.
        if (spiky && found.outside[i]) continue
        lineCount++
        if (distance(region.data, i, background.rgb) > 60 && (!weak || !found.outside[i] || distance(region.data, i, outsideGround.rgb) > 60)) leftover++
      }
      if (leftover > lineCount * 0.04) { textured = true; mask = new Uint8Array(width * height); if (weak) { region.data.set(before); interior = null } }
    }
    // Texto sobre desenho, degradê ou textura: com os modelos, apaga exatamente os pixels das letras
    // (máscara do detector) e reconstrói o desenho por baixo. Sem máscara para esta
    // fala (modelo ausente ou letra não achada), segue o apagamento por cor.
    let erased = false
    // Balão limpo fica de fora. Em fundo liso claro, a máscara do modelo só diz quais
    // pixels são letra, e eles são pintados com a cor do fundo (a reconstrução borraria);
    // assim o contorno do balão encostado nas letras não vira retângulo branco.
    // Fundo escuro "liso" costuma ter listras e granulado: lá entra a reconstrução.
    const plainLight = flat && !textured && luminance(background.rgb[0], background.rgb[1], background.rgb[2]) > 160
    if (models && !(interior && !textured)) {
      const page = await models.mask()
      if (page) {
        // Só as letras desta fala: em volta das linhas dela, nunca o texto do balão vizinho.
        const reach = Math.max(linePad, Math.round(lineHeight * 0.25))
        const near = (x: number, y: number) => lines.some(([x1, y1, x2, y2]) => x + left >= x1 - reach && x + left <= x2 + reach && y + top >= y1 - reach && y + top <= y2 + reach)
        const letters = new Uint8Array(width * height); let count = 0
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          if (!page[(y + top) * W + x + left] || !near(x, y)) continue
          letters[y * width + x] = 1; count++
        }
        let lineArea = 0
        for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) if (inLine(x, y)) lineArea += 4
        // O detector às vezes perde letra colorida ou contornada (azul sobre cinza,
        // brilho no degradê). Dentro das linhas, o que destoa muito do fundo em volta
        // da própria linha também é letra e entra na reconstrução.
        if (count >= lineArea * 0.03 && !plainLight) for (const [lx1, ly1, lx2, ly2] of lines) {
          const ring: number[] = []
          for (let y = Math.max(0, ly1 - top - linePad * 2); y < Math.min(height, ly2 - top + linePad * 2); y += 2) for (let x = Math.max(0, lx1 - left - linePad * 2); x < Math.min(width, lx2 - left + linePad * 2); x += 2) {
            if (x + left >= lx1 && x + left <= lx2 && y + top >= ly1 && y + top <= ly2) continue
            const i = y * width + x; ring.push(luminance(region.data[i * 3], region.data[i * 3 + 1], region.data[i * 3 + 2]))
          }
          ring.sort((p, q) => p - q)
          const ground = ring.length ? ring[Math.floor(ring.length / 2)] : 255
          for (let y = Math.max(0, ly1 - top); y < Math.min(height, ly2 - top); y++) for (let x = Math.max(0, lx1 - left); x < Math.min(width, lx2 - left); x++) {
            const i = y * width + x
            if (!letters[i] && Math.abs(luminance(region.data[i * 3], region.data[i * 3 + 1], region.data[i * 3 + 2]) - ground) > 100) { letters[i] = 1; count++ }
          }
        }
        if (count >= lineArea * 0.03) {
          // Contorno e brilho em volta da letra também saem; letra clara em fundo escuro tem brilho mais largo.
          const glow = luminance(background.rgb[0], background.rgb[1], background.rgb[2]) < 90 ? 0.14 : 0.08
          const grown = dilate(letters, width, height, Math.max(2, Math.round(lineHeight * glow)), near)
          const ring = dominant(region, (x, y) => !inErase(x, y) && (inErase(x - 3, y) || inErase(x + 3, y) || inErase(x, y - 3) || inErase(x, y + 3)))
          const sameColor = plainLight || (flat && ring.share >= 0.9 && distance(Float32Array.from(ring.rgb), 0, background.rgb) <= 30)
          if (sameColor) {
            const saved = region.data.slice()
            paintMask(region, grown, background.rgb)
            erased = true
            // Fundo claro liso: se ainda sobra tinta nas linhas (letra colorida ou
            // contornada que o detector não marcou), volta ao apagamento por cor.
            let inside = 0; let left_ = 0
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (inLine(x, y)) { inside++; if (distance(region.data, y * width + x, background.rgb) > 90) left_++ }
            if (left_ > inside * 0.04) { region.data.set(saved); erased = false }
          } else erased = await models.inpaint(region.data, width, height, grown)
        }
      }
    }
    if (erased || (interior && !textured)) {
      // Miolo limpo, ou letras já apagadas pelos modelos.
    } else if (!textured) {
      // Em volta da área do texto o fundo continua liso: pintar com a cor dele.
      // Senão (degradê, desenho encostado), preencher a partir do redor, para não
      // sobrar um retângulo de cor chapada.
      const ring = dominant(region, (x, y) => !inErase(x, y) && (inErase(x - 3, y) || inErase(x + 3, y) || inErase(x, y - 3) || inErase(x, y + 3)))
      const sameColor = ring.share >= 0.9 && distance(Float32Array.from(ring.rgb), 0, background.rgb) <= 30
      if (sameColor) { for (let i = 0; i < width * height; i++) if (mask[i]) { region.data[i * 3] = background.rgb[0]; region.data[i * 3 + 1] = background.rgb[1]; region.data[i * 3 + 2] = background.rgb[2] } }
      else await inpaint(region, mask)
    } else {
      // Texto sobre desenho: apagar só as letras (a cor delas e o contorno em
      // volta) e reconstruir esse pouco a partir do redor. Apagar o retângulo
      // inteiro deixava um borrão no lugar da arte.
      const reach = Math.max(3, Math.round(lineHeight * 0.14))
      // Cor das letras: a que é comum nas linhas e rara em volta. Sem uma cor
      // assim, num fundo liso com listras, letra é tudo que não é a cor do fundo.
      const color = textColor(region, inLinePadded, (x, y) => inErase(x, y) && !inLinePadded(x, y))
      const isInk = (i: number) => color ? distance(region.data, i, color) <= 90 : flat && distance(region.data, i, background.rgb) > 45
      const same = new Uint8Array(width * height)
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (inErase(x, y) && isInk(y * width + x)) same[y * width + x] = 1
      // Desenho da mesma cor que as letras (cabelo, espada, listras) encosta nelas:
      // só conta o que está quase todo dentro das linhas, com tamanho de letra.
      const letters = new Uint8Array(width * height)
      const seen = new Uint8Array(width * height); const stack: number[] = []
      for (let start = 0; start < width * height; start++) {
        if (!same[start] || seen[start]) continue
        const component: number[] = []; let within = 0; let minY = height; let maxY = 0
        stack.push(start); seen[start] = 1
        while (stack.length) {
          const i = stack.pop()!; component.push(i)
          const x = i % width; const y = (i - x) / width
          if (inLinePadded(x, y)) within++
          if (y < minY) minY = y; if (y > maxY) maxY = y
          for (const next of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) if (next >= 0 && same[next] && !seen[next]) { seen[next] = 1; stack.push(next) }
        }
        // Letras com brilho grudam umas nas outras entre linhas: altas, mas inteiras dentro do texto.
        const share = within / component.length
        if (share >= 0.7 && (maxY - minY <= lineHeight * 1.6 || share >= 0.9)) for (const i of component) letters[i] = 1
      }
      // Letras já achadas pelo caminho do fundo liso também entram. Em fundo liso
      // listrado, letra é o que tem brilho bem diferente do fundo dentro das linhas
      // (as listras grudam nas letras e escapam da separação por partes).
      if (flat) {
        const ground = luminance(background.rgb[0], background.rgb[1], background.rgb[2])
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const i = y * width + x
          if (mask[i] || (inLinePadded(x, y) && Math.abs(luminance(region.data[i * 3], region.data[i * 3 + 1], region.data[i * 3 + 2]) - ground) > 100)) letters[i] = 1
        }
      }
      let lineCount = 0; let hits = 0
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (inLinePadded(x, y)) { lineCount++; if (letters[y * width + x]) hits++ }
      const share = hits / Math.max(1, lineCount)
      if (share >= 0.02 && share <= 0.75) {
        // Contorno e brilho: em volta da letra, o que contrasta com ela até "reach".
        const ink = color || (luminance(background.rgb[0], background.rgb[1], background.rgb[2]) < 128 ? [255, 255, 255] : [0, 0, 0])
        const light = luminance(ink[0], ink[1], ink[2]) >= 128
        const near = dilate(letters, width, height, reach)
        for (let i = 0; i < width * height; i++) {
          if (!near[i] || letters[i]) continue
          const value = luminance(region.data[i * 3], region.data[i * 3 + 1], region.data[i * 3 + 2])
          const glow = flat && distance(region.data, i, background.rgb) > 60
          if (glow || (light ? value < 70 : value > 185)) letters[i] = 1
        }
        const grown = dilate(letters, width, height, 2)
        // Balão escuro listrado: a cor do fundo cobre as letras sem borrar; a
        // reconstrução a partir das listras deixava manchas e letras fantasmas.
        if (flat) paintMask(region, grown, background.rgb)
        else await inpaint(region, grown)
      } else {
        // Sem uma cor de letra clara: cada linha é tratada pelo fundo em volta
        // dela (uma fala pode começar no branco e terminar num balão escuro).
        for (const [lx1, ly1, lx2, ly2] of lines) {
          const pad = linePad * 2
          const inRect = (x: number, y: number) => x + left >= lx1 - linePad && x + left <= lx2 + linePad && y + top >= ly1 - linePad && y + top <= ly2 + linePad
          const inRing = (x: number, y: number) => !inRect(x, y) && x + left >= lx1 - pad && x + left <= lx2 + pad && y + top >= ly1 - pad && y + top <= ly2 + pad
          // Brilho típico em volta da linha: a letra é o que foge muito dele (letra
          // branca em balão escuro listrado, letra preta no branco).
          const values: number[] = []
          for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) if (inRing(x, y)) { const i = y * width + x; values.push(luminance(region.data[i * 3], region.data[i * 3 + 1], region.data[i * 3 + 2])) }
          values.sort((p, q) => p - q)
          const ground = values.length ? values[Math.floor(values.length / 2)] : 255
          const lineMask = new Uint8Array(width * height)
          let inside = 0; let hits = 0
          for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            if (!inRect(x, y)) continue
            const i = y * width + x
            inside++
            if (Math.abs(luminance(region.data[i * 3], region.data[i * 3 + 1], region.data[i * 3 + 2]) - ground) > 100) { lineMask[i] = 1; hits++ }
          }
          const share = hits / Math.max(1, inside)
          // Cor de pintura: a média do que está em volta com o brilho típico (o
          // branco fora do balão não pinta o miolo escuro).
          const paint = [0, 0, 0]; let count = 0
          for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
            if (!inRing(x, y)) continue
            const i = y * width + x
            if (Math.abs(luminance(region.data[i * 3], region.data[i * 3 + 1], region.data[i * 3 + 2]) - ground) > 40) continue
            paint[0] += region.data[i * 3]; paint[1] += region.data[i * 3 + 1]; paint[2] += region.data[i * 3 + 2]; count++
          }
          if (share >= 0.02 && share <= 0.75 && count) paintMask(region, dilate(lineMask, width, height, 3, inRect), paint.map((value) => value / count))
          else {
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (inRect(x, y)) lineMask[y * width + x] = 1
            await inpaint(region, lineMask)
          }
        }
      }
    }
    writeRegion(canvas, region)
    // Medidas para a conferência: letra original = pixel da linha com brilho bem
    // diferente do que está em volta da própria linha (fundo listrado ou dois fundos).
    let ink = 0; let kept = 0; let changed = 0; let eraseArea = 0
    const diff = (i: number) => Math.abs(before[i * 3] - region.data[i * 3]) + Math.abs(before[i * 3 + 1] - region.data[i * 3 + 1]) + Math.abs(before[i * 3 + 2] - region.data[i * 3 + 2])
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (inErase(x, y)) { eraseArea++; if (diff(y * width + x) > 30) changed++ }
    for (const [lx1, ly1, lx2, ly2] of lines) {
      const ring: number[] = []
      for (let y = Math.max(0, ly1 - top - linePad * 2); y < Math.min(height, ly2 - top + linePad * 2); y += 2) for (let x = Math.max(0, lx1 - left - linePad * 2); x < Math.min(width, lx2 - left + linePad * 2); x += 2) {
        if (x + left >= lx1 && x + left <= lx2 && y + top >= ly1 && y + top <= ly2) continue
        const i = y * width + x; ring.push(luminance(before[i * 3], before[i * 3 + 1], before[i * 3 + 2]))
      }
      ring.sort((p, q) => p - q)
      // Balão achado: o fundo é a cor dele (o redor da linha pode ter espinhos ou o fundo de fora).
      const ground = interior ? luminance(background.rgb[0], background.rgb[1], background.rgb[2]) : ring.length ? ring[Math.floor(ring.length / 2)] : 255
      for (let y = Math.max(0, ly1 - top); y < Math.min(height, ly2 - top); y++) for (let x = Math.max(0, lx1 - left); x < Math.min(width, lx2 - left); x++) {
        const i = y * width + x
        if (Math.abs(luminance(before[i * 3], before[i * 3 + 1], before[i * 3 + 2]) - ground) <= 100) continue
        ink++
        if (diff(i) < 30) kept++
      }
    }
    const method: RenderDiagnostic['method'] = interior && !textured ? 'balloon' : flat && !textured ? 'flat' : flat ? 'textured' : 'art'
    // Onde o texto vai: o miolo do balão. Sem miolo liso achado (balão escuro com
    // textura, fala fora da caixa do detector), o contorno é procurado de novo na
    // página já apagada, numa área maior; ele só serve para posicionar o texto.
    // Fala cortada entre imagens: cada imagem acha um pedaço diferente do balão, então
    // o texto se posiciona só pelas linhas, iguais nas duas, para as metades se encaixarem.
    let place = interior && !raw.joined ? { ...interior, left, top } : null
    if (!place && raw.kind === 'balloon' && !raw.joined) {
      const margin = Math.round(Math.max(120, span * 0.5))
      const pl = clamp(Math.floor(ox1) - margin, 0, W - 1); const pt = clamp(Math.floor(oy1) - margin, 0, H - 1)
      const wide = readRegion(canvas, pl, pt, clamp(Math.ceil(ox2) + margin, pl + 1, W) - pl, clamp(Math.ceil(oy2) + margin, pt + 1, H) - pt)
      const seeds = (x: number, y: number) => lines.some(([x1, y1, x2, y2]) => x + pl >= x1 && x + pl <= x2 && y + pt >= y1 && y + pt <= y2)
      const around = (x: number, y: number) => x + pl >= ex1 && x + pl < ex2 && y + pt >= ey1 && y + pt < ey2
      const ground = dominant(wide, around)
      const found = ground.share > 0.5 ? balloonInterior(wide, ground.rgb, seeds) : texturedInterior(wide, around, seeds, lineHeight)
      // O texto original fica no meio do balão; contorno achado fora disso é outra coisa.
      const centered = found && Math.abs(pl + (found.x1 + found.x2) / 2 - (tx1 + tx2) / 2) <= (found.x2 - found.x1) * 0.25 && Math.abs(pt + (found.y1 + found.y2) / 2 - (ty1 + ty2) / 2) <= (found.y2 - found.y1) * 0.25
      if (found && centered && covers(found, pl, pt) && !crosses(found, pl, pt)) place = { ...found, left: pl, top: pt }
      await breathe()
    }
    if (place) drawn.push({ box: [place.left + place.x1, place.top + place.y1, place.left + place.x2, place.top + place.y2], source: raw.source || raw.text })

    // A tradução ocupa o lugar do texto original, com folga para o PT-BR ser mais longo.
    // Linhas do detector são mais altas que as letras; o balão limita a largura.
    const boxWidth = raw.kind === 'balloon' && bx1 <= tx1 + pad && bx2 >= tx2 - pad ? (bx2 - bx1) * 0.86 : Infinity
    const source = raw.source || text
    // Caixa alta pela maioria das letras: o OCR às vezes lê "troUBlEsoME" num texto todo em maiúsculas.
    // Fala curta ("YUP!") não tem letras suficientes para a fração: vale estar toda em maiúsculas.
    const uppercase = pageUppercase && !raw.joined ? upperShare(source) !== -1 || source === source.toUpperCase() : upperShare(source) >= 0.6 || (/[A-Z]/.test(source) && source === source.toUpperCase())
    const maxSize = Math.max(10, Math.round(lineHeight * 0.85))
    let fit: ReturnType<typeof fitText> = { size: 10, lineHeight: 11.5, lines: [] }
    let centerX = (tx1 + tx2) / 2; let centerY = (ty1 + ty2) / 2
    // Pelas linhas do original: o texto novo ocupa o lugar do antigo.
    const byLines = () => {
      // Um pouco de folga dos lados: letra grande encostada na borda do balão parece vazar.
      const availW = Math.min(Math.max(40, (tx2 - tx1) * 1.08), Math.max(boxWidth, tx2 - tx1)) * 0.94
      const availH = Math.max(lineHeight, (ty2 - ty1) * 1.15)
      fit = fitText(uppercase ? text.toUpperCase() : text, availW, availH, maxSize)
      centerX = (tx1 + tx2) / 2; centerY = (ty1 + ty2) / 2
    }
    if (place) {
      const inner = place
      // Dentro do balão: cada linha usa a largura real do miolo na altura dela (o
      // maior trecho livre da linha; num balão em L, o trecho do lado largo).
      const runs: Array<[number, number]> = Array.from({ length: inner.height }, () => [0, 0])
      for (let y = inner.y1; y < inner.y2; y++) {
        let best: [number, number] = [0, 0]; let start = -1
        for (let x = inner.x1; x <= inner.x2; x++) {
          const free = x < inner.x2 && !inner.outside[y * inner.width + x]
          if (free && start < 0) start = x
          if (!free && start >= 0) { if (x - start > best[1] - best[0]) best = [start, x]; start = -1 }
        }
        runs[y] = best
      }
      // Centro do texto: o meio do trecho livre em algumas alturas do balão (num
      // balão em L, o lado largo); fica o centro em que a letra sai maior.
      const label = uppercase ? text.toUpperCase() : text
      const span = inner.y2 - inner.y1
      const options = [0.5, 0.35, 0.65, 0.25, 0.75].map((share) => {
        const y = Math.round(inner.y1 + span * share)
        const [a, b] = runs[y] || [0, 0]
        const cx = Math.round((a + b) / 2)
        // Faixa vertical em que a coluna "cx" continua dentro do balão.
        let up = y; let down = y
        while (up > inner.y1 && runs[up - 1][0] <= cx && runs[up - 1][1] >= cx) up--
        while (down < inner.y2 - 1 && runs[down + 1][0] <= cx && runs[down + 1][1] >= cx) down++
        const cy = (up + down) / 2
        const room = (from: number, to: number) => {
          let narrowest = Infinity
          for (let row = Math.floor(cy + from); row <= Math.ceil(cy + to); row++) {
            const [ra, rb] = row >= 0 && row < inner.height ? runs[row] : [0, 0]
            narrowest = Math.min(narrowest, ra <= cx && rb >= cx ? Math.min(cx - ra, rb - cx) : 0)
          }
          return narrowest * 2 * 0.88
        }
        return { cx, cy, fit: fitText(label, (inner.x2 - inner.x1) * 0.9, (down - up) * 0.86, maxSize, room) }
      }).filter((option) => option.fit.lines.length)
      const best = options.sort((a, b) => b.fit.size - a.fit.size)[0]
      fit = best.fit
      centerX = inner.left + best.cx; centerY = inner.top + best.cy
      // Miolo achado em que o texto não cabe (balões encostados de mangá, miolo
      // vazando para o vizinho): vale o lugar do texto original.
      if (best.fit.overflow) byLines()
    } else byLines()
    // O texto não sai pelas laterais da imagem (balão cortado pela borda da página).
    const widest = Math.max(0, ...fit.lines.map((line) => textWidth(line, fit.size)))
    if (widest < W - 8) centerX = clamp(centerX, widest / 2 + 4, W - widest / 2 - 4)
    let sum = 0; let count = 0
    for (let y = 0; y < height; y += 3) for (let x = 0; x < width; x += 3) if (inErase(x, y)) { const i = y * width + x; sum += luminance(region.data[i * 3], region.data[i * 3 + 1], region.data[i * 3 + 2]); count++ }
    const ground = sum / Math.max(1, count)
    const dark = ground < 140
    // Cor da letra original, quando ela se destaca do fundo (fala vermelha, roxa, azul).
    const beforeRegion = { ...region, data: before }
    const original = textColor(beforeRegion, inLine, (x, y) => inErase(x, y) && !inLinePadded(x, y))
    const hex = (rgb: number[]) => `#${rgb.map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('')}`
    const fillRgb = original && Math.abs(luminance(original[0], original[1], original[2]) - ground) >= 100 ? original : dark ? [255, 255, 255] : [17, 17, 17]
    const fill = hex(fillRgb)
    const strokeColor = luminance(fillRgb[0], fillRgb[1], fillRgb[2]) > 128 ? '#000000' : '#ffffff'
    const stroke = flat && !textured ? '' : ` stroke="${strokeColor}" stroke-width="${(fit.size * 0.18).toFixed(1)}" paint-order="stroke" stroke-linejoin="round"`
    const first = centerY - ((fit.lines.length - 1) * fit.lineHeight) / 2 + fit.size * 0.36
    if (diagnostics) {
      // Texto fora do balão: pontos das letras desenhadas que caem fora do miolo
      // (ou da caixa do detector, sem miolo).
      let outside = 0; let points = 0
      fit.lines.forEach((line, index) => {
        const w = textWidth(line, fit.size); const baseline = first + index * fit.lineHeight
        for (let y = baseline - fit.size * 0.72; y <= baseline; y += 2) for (let x = centerX - w / 2; x <= centerX + w / 2; x += 2) {
          points++
          if (place) { const px = Math.round(x - place.left); const py = Math.round(y - place.top); if (px < 0 || py < 0 || px >= place.width || py >= place.height || place.outside[py * place.width + px]) outside++ }
          // Sem contorno achado: a caixa do detector ou as linhas do original, o que for maior.
          else if (raw.kind === 'balloon' && (x < Math.min(bx1, tx1) || x > Math.max(bx2, tx2) || y < Math.min(by1, ty1) || y > Math.max(by2, ty2))) outside++
        }
      })
      // Contorno apagado: tinta fora das linhas de texto (borda do balão, desenho)
      // que o apagamento mudou. Miolo de balão limpo não conta: lá tudo é fala.
      let erasedOutside = 0
      if (!interior) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (inLinePadded(x, y) || diff(i) <= 60) continue
        if (Math.abs(luminance(before[i * 3], before[i * 3 + 1], before[i * 3 + 2]) - luminance(background.rgb[0], background.rgb[1], background.rgb[2])) > 100) erasedOutside++
      }
      diagnostics.push({ box: raw.box, source: raw.source || '', method, residue: ink ? kept / ink : 0, repainted: method === 'art' || method === 'textured' ? changed / Math.max(1, eraseArea) : 0, size: fit.size, overflow: outside / Math.max(1, points), border: erasedOutside / Math.max(1, lineHeight * lineHeight) })
    }
    texts.push(`<text text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${fit.size}" fill="${fill}"${stroke}>${fit.lines.map((line, i) => `<tspan x="${centerX.toFixed(1)}" y="${(first + i * fit.lineHeight).toFixed(1)}">${escape(line)}</tspan>`).join('')}</text>`)
  }
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${texts.join('')}</svg>`)
  return sharp(Buffer.from(canvas.data.buffer, canvas.data.byteOffset, canvas.data.length), { raw: { width: W, height: H, channels: 3 } })
    .composite([{ input: svg, left: 0, top: 0 }]).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
}
