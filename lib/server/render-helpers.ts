// Tipos e funções de pixels e de texto do desenho das páginas traduzidas,
// separados de render-translation.ts sem mudar o comportamento.

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

export const FONT = "'Noto Sans','Liberation Sans','DejaVu Sans',sans-serif"
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
export const escape = (value: string) => value.replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char]!))

export interface Region { left: number; top: number; width: number; height: number; data: Float32Array }
// A página inteira fica numa tela de trabalho: cada balão lê e grava nela, então
// um balão apagado não é desfeito por outro que se sobrepõe a ele.
export interface Canvas { width: number; height: number; data: Uint8Array }
export function readRegion(canvas: Canvas, left: number, top: number, width: number, height: number): Region {
  const data = new Float32Array(width * height * 3)
  for (let y = 0; y < height; y++) for (let x = 0; x < width * 3; x++) data[y * width * 3 + x] = canvas.data[((top + y) * canvas.width + left) * 3 + x]
  return { left, top, width, height, data }
}
export function writeRegion(canvas: Canvas, region: Region) {
  const { left, top, width, height, data } = region
  for (let y = 0; y < height; y++) for (let x = 0; x < width * 3; x++) canvas.data[((top + y) * canvas.width + left) * 3 + x] = Math.max(0, Math.min(255, Math.round(data[y * width * 3 + x])))
}
export const luminance = (r: number, g: number, b: number) => r * 0.299 + g * 0.587 + b * 0.114

/** Cor dominante (histograma grosso) e a fração de pixels que ela cobre. */
export function dominant(region: Region, inside: (x: number, y: number) => boolean) {
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

export function boxBlur(source: Float32Array, width: number, height: number, channels: number, radius: number) {
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
export let lastYield = performance.now()
export async function breathe() {
  if (performance.now() - lastYield < 25) return
  await new Promise((resolve) => setImmediate(resolve))
  lastYield = performance.now()
}

export async function inpaint(region: Region, mask: Uint8Array) {
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
export function charWidth(char: string) {
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
export function upperShare(text: string) {
  const letters = text.replace(/[^A-Za-z]/g, '')
  return letters.length > 3 ? letters.replace(/[^A-Z]/g, '').length / letters.length : -1
}

export const distance = (data: Float32Array, i: number, rgb: number[]) => Math.abs(data[i * 3] - rgb[0]) + Math.abs(data[i * 3 + 1] - rgb[1]) + Math.abs(data[i * 3 + 2] - rgb[2])

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

export function paintMask(region: Region, mask: Uint8Array, rgb: number[]) {
  for (let i = 0; i < mask.length; i++) if (mask[i]) { region.data[i * 3] = rgb[0]; region.data[i * 3 + 1] = rgb[1]; region.data[i * 3 + 2] = rgb[2] }
}

/** Engrossa a máscara em "reach" pixels (contorno e brilho em volta das letras). */
export function dilate(mask: Uint8Array, width: number, height: number, reach: number, allowed: (x: number, y: number) => boolean = () => true) {
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
export function texturedInterior(region: Region, inErase: (x: number, y: number) => boolean, inLines: (x: number, y: number) => boolean, lineHeight: number) {
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
