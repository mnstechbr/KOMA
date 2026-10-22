// Gerador de QR code (modo byte, correção M, versões 1 a 10), sem dependências.
// Serve para o endereço de "Ler no celular", que cabe com folga na versão 4.
// Segue a norma ISO/IEC 18004; a estrutura é a do gerador de referência de Nayuki.

// Por versão: [palavras de correção por bloco, blocos curtos, dados por bloco curto, blocos longos].
const ECC_M: Array<[number, number, number, number]> = [
  [0, 0, 0, 0],
  [10, 1, 16, 0],
  [16, 1, 28, 0],
  [26, 1, 44, 0],
  [18, 2, 32, 0],
  [24, 2, 43, 0],
  [16, 4, 27, 0],
  [18, 4, 31, 0],
  [22, 2, 38, 2],
  [22, 3, 36, 2],
  [26, 4, 43, 1],
]
const ALIGNMENT: number[][] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]

function multiply(x: number, y: number) {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}
function divisor(degree: number) {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = multiply(result[j], root)
      if (j + 1 < degree) result[j] ^= result[j + 1]
    }
    root = multiply(root, 0x02)
  }
  return result
}
/** Palavras de correção Reed-Solomon de um bloco de dados. */
export function reedSolomon(data: number[], degree: number) {
  const gen = divisor(degree)
  const result = new Array<number>(degree).fill(0)
  for (const byte of data) {
    const factor = byte ^ result.shift()!
    result.push(0)
    gen.forEach((coefficient, index) => {
      result[index] ^= multiply(coefficient, factor)
    })
  }
  return result
}

function capacity(version: number) {
  const [, short, data, long] = ECC_M[version]
  return short * data + long * (data + 1)
}

/** Matriz do QR code (true = módulo escuro) para um texto. */
export function qrMatrix(text: string, forceMask?: number): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)]
  let version = 1
  while (version <= 10 && 4 + (version < 10 ? 8 : 16) + bytes.length * 8 > capacity(version) * 8) version++
  if (version > 10) throw new Error('Texto longo demais para o QR code.')
  // Dados: modo byte, tamanho, bytes, terminador e preenchimento.
  const bits: number[] = []
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }
  push(0b0100, 4)
  push(bytes.length, version < 10 ? 8 : 16)
  for (const byte of bytes) push(byte, 8)
  const total = capacity(version) * 8
  push(0, Math.min(4, total - bits.length))
  while (bits.length % 8) bits.push(0)
  for (let pad = 0xec; bits.length < total; pad ^= 0xec ^ 0x11) push(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0))
  // Blocos, correção e intercalação.
  const [ecc, short, shortData, long] = ECC_M[version]
  const blocks: Array<{ data: number[]; ecc: number[] }> = []
  for (let index = 0, offset = 0; index < short + long; index++) {
    const size = shortData + (index >= short ? 1 : 0)
    const chunk = data.slice(offset, offset + size)
    offset += size
    blocks.push({ data: chunk, ecc: reedSolomon(chunk, ecc) })
  }
  const codewords: number[] = []
  for (let i = 0; i <= shortData; i++) for (const block of blocks) if (i < block.data.length) codewords.push(block.data[i])
  for (let i = 0; i < ecc; i++) for (const block of blocks) codewords.push(block.ecc[i])

  const size = version * 4 + 17
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const set = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark
    fixed[y][x] = true
  }
  // Padrões fixos: temporização, localizadores, alinhamento e informação de versão.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        const distance = Math.max(Math.abs(dx), Math.abs(dy))
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, distance !== 2 && distance !== 4)
      }
  }
  const positions = ALIGNMENT[version]
  for (let i = 0; i < positions.length; i++)
    for (let j = 0; j < positions.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === positions.length - 1) || (i === positions.length - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) set(positions[i] + dx, positions[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  const drawFormat = (mask: number) => {
    const value = (0 << 3) | mask // correção M = 00
    let rem = value
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const format = ((value << 10) | rem) ^ 0x5412
    const bit = (i: number) => ((format >>> i) & 1) === 1
    for (let i = 0; i <= 5; i++) set(8, i, bit(i))
    set(8, 7, bit(6))
    set(8, 8, bit(7))
    set(7, 8, bit(8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
    set(8, size - 8, true)
  }
  drawFormat(0)
  if (version >= 7) {
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const info = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const dark = ((info >>> i) & 1) === 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(a, b, dark)
      set(b, a, dark)
    }
  }
  // Dados em zigue-zague, de baixo para cima, pulando a coluna de temporização.
  let index = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vertical = 0; vertical < size; vertical++)
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vertical : vertical
        if (!fixed[y][x] && index < codewords.length * 8) {
          modules[y][x] = ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) === 1
          index++
        }
      }
  }
  const masks: Array<(x: number, y: number) => boolean> = [
    (x, y) => (x + y) % 2 === 0,
    (_x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ]
  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && masks[mask](x, y)) modules[y][x] = !modules[y][x]
  }
  // Máscara com menos penalidade (blocos e sequências da mesma cor, proporção de escuros).
  const penalty = () => {
    let score = 0
    for (let pass = 0; pass < 2; pass++)
      for (let a = 0; a < size; a++) {
        let run = 1
        for (let b = 1; b < size; b++) {
          const same = pass ? modules[b][a] === modules[b - 1][a] : modules[a][b] === modules[a][b - 1]
          if (same) {
            run++
            if (run === 5) score += 3
            else if (run > 5) score++
          } else run = 1
        }
      }
    for (let y = 0; y < size - 1; y++)
      for (let x = 0; x < size - 1; x++) {
        const color = modules[y][x]
        if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) score += 3
      }
    const dark = modules.flat().filter(Boolean).length
    score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10
    return score
  }
  let best = 0
  let lowest = Infinity
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask)
    drawFormat(mask)
    const score = penalty()
    if (score < lowest) {
      lowest = score
      best = mask
    }
    applyMask(mask)
  }
  if (forceMask !== undefined) best = forceMask
  applyMask(best)
  drawFormat(best)
  return modules
}

/** SVG do QR code, com a margem branca que os leitores exigem. */
export function qrSvg(text: string, scale = 6) {
  const matrix = qrMatrix(text)
  const margin = 4
  const side = (matrix.length + margin * 2) * scale
  const cells = matrix
    .flatMap((row, y) =>
      row.flatMap((dark, x) => (dark ? [`M${(x + margin) * scale} ${(y + margin) * scale}h${scale}v${scale}h-${scale}z`] : [])),
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${cells}" fill="#000"/></svg>`
}
