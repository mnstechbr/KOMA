import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { SQLITE_MIGRATIONS } from '../lib/backend/shared/migrations'
import {
  acceptCudaLicenses,
  cudaSettings,
  cudaSupport,
  downloadFile,
  extractZip,
  installCuda,
  missingPackages,
  parseDriverVersion,
  removeCuda,
  type CudaPackage,
} from '../lib/backend/works/cuda-addon'
import { CUDA_LIBS, CUDA_PROVIDER, prepareCuda } from '../lib/server/inpaint'

const sha = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex')
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'koma-cuda-'))

// Zip mínimo (como wheel/nupkg): entradas guardadas (0) ou comprimidas (8).
function zip(entries: Array<{ name: string; data: Buffer; deflate?: boolean }>) {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const body = entry.deflate ? zlib.deflateRawSync(entry.data) : entry.data
    const name = Buffer.from(entry.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(entry.deflate ? 8 : 0, 10)
    header.writeUInt32LE(body.length, 20)
    header.writeUInt32LE(entry.data.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(offset, 42)
    locals.push(local, name, body)
    central.push(header, name)
    offset += 30 + name.length + body.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

// Servidor local com download em partes (Range), que pode travar no meio para simular queda.
let server: http.Server
let base = ''
const files = new Map<string, Buffer>()
let failAfter = Infinity
let served = 0
beforeAll(async () => {
  server = http.createServer((request, response) => {
    const data = files.get(request.url || '')
    if (!data) return response.writeHead(404).end()
    const [start, end] = (request.headers.range || '').replace('bytes=', '').split('-').map(Number)
    if (served++ >= failAfter) return response.destroy()
    response.writeHead(206, { 'Content-Length': end - start + 1 })
    response.end(data.subarray(start, end + 1))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

describe('complemento CUDA', () => {
  it('lê a versão do driver NVIDIA e só oferece no Linux x64 com driver 580+', () => {
    expect(parseDriverVersion('NVRM version: NVIDIA UNIX Open Kernel Module for x86_64  615.78.08  Release Build  (dvs)')).toBe(615)
    expect(parseDriverVersion('NVRM version: NVIDIA UNIX x86_64 Kernel Module  535.183.01  Sun May 12 2024')).toBe(535)
    expect(parseDriverVersion('sem driver')).toBeNull()
    expect(cudaSupport('linux', 'x64', 615)).toEqual({ supported: true, reason: null })
    expect(cudaSupport('linux', 'x64', 535).reason).toBe('old-driver')
    expect(cudaSupport('linux', 'x64', null).reason).toBe('no-nvidia')
    expect(cudaSupport('win32', 'x64', 615).reason).toBe('platform')
  })

  it('extrai do zip só os arquivos pedidos e recusa arquivo adulterado', async () => {
    const dir = temp()
    const lib = crypto.randomBytes(5000)
    const file = path.join(dir, 'pacote.whl')
    fs.writeFileSync(
      file,
      zip([
        { name: 'nvidia/cu13/lib/libteste.so.1', data: lib, deflate: true },
        { name: 'nvidia/cu13/lib/outro.so', data: Buffer.from('não pedido') },
      ]),
    )
    await extractZip(file, { 'nvidia/cu13/lib/libteste.so.1': { name: 'libteste.so.1', sha256: sha(lib) } }, path.join(dir, 'lib'))
    expect(fs.readFileSync(path.join(dir, 'lib/libteste.so.1')).equals(lib)).toBe(true)
    expect(fs.existsSync(path.join(dir, 'lib/outro.so'))).toBe(false)
    await expect(
      extractZip(file, { 'nvidia/cu13/lib/outro.so': { name: 'outro.so', sha256: 'f'.repeat(64) } }, path.join(dir, 'lib')),
    ).rejects.toThrow(/não confere/)
    await expect(extractZip(file, { 'nao/existe.so': { name: 'x.so', sha256: 'f'.repeat(64) } }, path.join(dir, 'lib'))).rejects.toThrow(
      /Faltam/,
    )
  })

  it('baixa em partes paralelas, retoma depois de uma queda e confere o SHA-256', async () => {
    const dir = temp()
    const data = crypto.randomBytes(100_000)
    files.set('/grande.bin', data)
    const target = path.join(dir, 'grande.bin')
    // Primeira tentativa cai depois de 3 partes.
    served = 0
    failAfter = 3
    await expect(downloadFile(`${base}/grande.bin`, target, data.length, sha(data), { connections: 1, chunk: 10_000 })).rejects.toThrow()
    expect(JSON.parse(fs.readFileSync(`${target}.partes.json`, 'utf8'))).toHaveLength(3)
    // Retoma: só as 7 partes que faltam são pedidas.
    served = 0
    failAfter = Infinity
    let last = 0
    await downloadFile(`${base}/grande.bin`, target, data.length, sha(data), {
      connections: 3,
      chunk: 10_000,
      onProgress: (bytes) => (last = bytes),
    })
    expect(served).toBe(7)
    expect(last).toBe(data.length)
    expect(fs.readFileSync(target).equals(data)).toBe(true)
    expect(fs.existsSync(`${target}.partes.json`)).toBe(false)
    await expect(
      downloadFile(`${base}/grande.bin`, path.join(dir, 'ruim.bin'), data.length, 'f'.repeat(64), { chunk: 50_000 }),
    ).rejects.toThrow(/não confere/)
    expect(fs.existsSync(path.join(dir, 'ruim.bin.partial'))).toBe(false)
  })

  it('instala (só com as licenças aceitas), reaproveita o que já existe e remove liberando o espaço', async () => {
    const db = new Database(':memory:')
    for (const migration of SQLITE_MIGRATIONS) db.exec(migration.up)
    const dir = path.join(temp(), 'cuda')
    const lib = crypto.randomBytes(20_000)
    const pkgZip = zip([{ name: 'runtimes/linux-x64/native/libfake.so', data: lib, deflate: true }])
    files.set('/pacote.nupkg', pkgZip)
    const packages: CudaPackage[] = [
      {
        id: 'fake',
        url: `${base}/pacote.nupkg`,
        sha256: sha(pkgZip),
        size: pkgZip.length,
        files: { 'runtimes/linux-x64/native/libfake.so': { name: 'libfake.so', sha256: sha(lib) } },
      },
    ]
    served = 0
    failAfter = Infinity
    await expect(installCuda(db, dir, packages)).rejects.toThrow(/aceitar/)
    expect(cudaSettings(db).enabled).toBe(false)
    expect(fs.existsSync(path.join(dir, 'lib/libfake.so'))).toBe(false)
    acceptCudaLicenses(db)
    await installCuda(db, dir, packages)
    expect(await missingPackages(dir, false, packages)).toEqual([])
    expect(cudaSettings(db)).toEqual({ enabled: true, accepted: true })
    expect(fs.existsSync(path.join(dir, 'downloads'))).toBe(false)
    // Arquivos já presentes e conferidos: nada é baixado de novo.
    served = 0
    await installCuda(db, dir, packages)
    expect(served).toBe(0)
    removeCuda(db, dir)
    expect(fs.existsSync(dir)).toBe(false)
    expect(cudaSettings(db).enabled).toBe(false)
  })

  it.skipIf(process.platform !== 'linux' || process.arch !== 'x64')(
    'prepara o CUDA: link do provider ao lado do onnxruntime e bibliotecas pré-carregadas',
    () => {
      const dir = temp()
      const ortDir = temp()
      expect(() => prepareCuda(dir, ortDir, vi.fn())).toThrow(/ausente/)
      fs.mkdirSync(path.join(dir, 'lib'))
      for (const name of [...CUDA_LIBS, CUDA_PROVIDER]) fs.writeFileSync(path.join(dir, 'lib', name), '')
      const load = vi.fn<typeof process.dlopen>(() => {
        throw new Error('Module did not self-register')
      })
      prepareCuda(dir, ortDir, load)
      expect(fs.readlinkSync(path.join(ortDir, CUDA_PROVIDER))).toBe(path.join(dir, 'lib', CUDA_PROVIDER))
      expect(load.mock.calls.map((call) => path.basename(call[1]))).toEqual(CUDA_LIBS)
      expect(load.mock.calls[0][2]).toBe(0x2 | 0x100 | 0x1000)
      const other = temp()
      fs.mkdirSync(path.join(other, 'lib'))
      for (const name of [...CUDA_LIBS, CUDA_PROVIDER]) fs.writeFileSync(path.join(other, 'lib', name), '')
      expect(() =>
        prepareCuda(other, temp(), () => {
          throw new Error('libcuda.so.1: cannot open shared object file')
        }),
      ).toThrow(/libcuda/)
    },
  )

  it('sem os arquivos do CUDA, o desenho volta sozinho para o WebGPU e registra o erro', async () => {
    const inpaint = await import('../lib/server/inpaint')
    if (!inpaint.inpaintAvailable()) return
    inpaint.configureInpaint('cuda', 0, path.join(temp(), 'cuda'))
    expect(await inpaint.lamaInpaint(new Float32Array(3), 1, 1, new Uint8Array(1))).toBe(true)
    expect(inpaint.drawStatus()).toMatchObject({ device: 'webgpu' })
    expect(inpaint.drawStatus().cudaError).toMatch(/ausente/)
    inpaint.configureInpaint('cpu')
  }, 60000)
})
