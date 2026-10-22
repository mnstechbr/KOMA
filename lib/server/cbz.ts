import fs from 'node:fs'
import zlib from 'node:zlib'

// ZIP sem compressão (método "store"): as páginas já são JPEG/PNG/WebP, então
// comprimir de novo só gastaria CPU. Gera arquivos .cbz que qualquer leitor de
// quadrinhos abre. Sem ZIP64: cada capítulo fica bem abaixo de 4 GB.

export interface ZipInput {
  name: string
  data: Buffer
}

function dosDateTime(date: Date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

export function buildZip(entries: ZipInput[], date = new Date()): Buffer {
  const { time, day } = dosDateTime(date)
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const crc = zlib.crc32(entry.data) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(day, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(entry.data.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, entry.data)
    centrals.push(central, name)
    offset += local.length + name.length + entry.data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

// Lê ZIPs gerados por buildZip (e outros sem compressão ou com deflate).
export function readZip(buffer: Buffer): ZipInput[] {
  let endAt = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--)
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      endAt = i
      break
    }
  if (endAt < 0) throw new Error('Arquivo de capítulo inválido.')
  const count = buffer.readUInt16LE(endAt + 10)
  let at = buffer.readUInt32LE(endAt + 16)
  const entries: ZipInput[] = []
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('Arquivo de capítulo inválido.')
    const method = buffer.readUInt16LE(at + 10)
    const crc = buffer.readUInt32LE(at + 16)
    const size = buffer.readUInt32LE(at + 20)
    const nameLength = buffer.readUInt16LE(at + 28)
    const extra = buffer.readUInt16LE(at + 30)
    const comment = buffer.readUInt16LE(at + 32)
    const localAt = buffer.readUInt32LE(at + 42)
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    const dataAt = localAt + 30 + buffer.readUInt16LE(localAt + 26) + buffer.readUInt16LE(localAt + 28)
    const raw = buffer.subarray(dataAt, dataAt + size)
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw) : null
    if (!data) throw new Error('Compressão não suportada no arquivo do capítulo.')
    if (zlib.crc32(data) >>> 0 !== crc) throw new Error('Arquivo de capítulo corrompido.')
    if (!name.endsWith('/')) entries.push({ name, data })
    at += 46 + nameLength + extra + comment
  }
  return entries
}

export function writeZipFile(file: string, entries: ZipInput[]) {
  fs.writeFileSync(`${file}.partial`, buildZip(entries))
  fs.renameSync(`${file}.partial`, file)
}
