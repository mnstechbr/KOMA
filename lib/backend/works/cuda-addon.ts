import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type Database from 'better-sqlite3'

// Complemento CUDA, opcional: baixa para uma pasta do usuário as bibliotecas oficiais
// da NVIDIA (redistribuíveis, PyPI) e o provider CUDA do onnxruntime (NuGet da
// Microsoft), com hash fixado. Nada disso vai no instalador. Só o desenho (máscara
// e LaMa) usa CUDA, e só no perfil Máximo; o OCR continua no WebGPU. Medido numa
// RTX 3070: 14 a 22% menos tempo em mangá e tiras longas, manhwa igual.

interface CudaFile {
  /** Nome final em <pasta>/lib. */
  name: string
  sha256: string
}
export interface CudaPackage {
  id: string
  url: string
  sha256: string
  size: number
  /** Caminho dentro do zip -> arquivo extraído. */
  files: Record<string, CudaFile>
}
const PYPI = 'https://files.pythonhosted.org/packages'
export const CUDA_PACKAGES: CudaPackage[] = [
  {
    id: 'nvidia-cuda-runtime 13.4.92',
    url: `${PYPI}/98/8a/3431271f6344874b8f1ac03f16b3d679c91493f8da63f716160403e6d0a0/nvidia_cuda_runtime-13.4.92-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl`,
    sha256: '9641f797da20ce1dd8e779b6e96d08cf9ba564cec8e8225458811ee26423f3a5',
    size: 2494438,
    files: {
      'nvidia/cu13/lib/libcudart.so.13': {
        name: 'libcudart.so.13',
        sha256: '7fb00519a24512bf677b59e87921e5c05aac8246ceb6a57435c0d9dfeef364f6',
      },
    },
  },
  {
    id: 'nvidia-cublas 13.8.1.7',
    url: `${PYPI}/eb/1b/adc70acf3fde509b1f0ca29d1c0e8d9b00aaecd871f8cf877257c8b68d9c/nvidia_cublas-13.8.1.7-py3-none-manylinux_2_27_x86_64.whl`,
    sha256: 'c11a27fd4379510e5b1f84b367a2514d1e52fe5cc13442117a0e0a1addee3cf2',
    size: 439315821,
    files: {
      'nvidia/cu13/lib/libcublas.so.13': {
        name: 'libcublas.so.13',
        sha256: '0d381da85431cfe42c9741452d92233b085b08cf0f237d0db2f4e03adff8842f',
      },
      'nvidia/cu13/lib/libcublasLt.so.13': {
        name: 'libcublasLt.so.13',
        sha256: '5c4b539a1df9ce975e042c852bfc80f7a7e439873d9298d4f699a28f6db112c4',
      },
    },
  },
  {
    id: 'nvidia-cufft 12.4.0.43',
    url: `${PYPI}/76/bf/3fea3d1c6262bded26ae00e3106432d63235954965d7785f5051ac146651/nvidia_cufft-12.4.0.43-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl`,
    sha256: '0e8385013596b112d29c9ce8c63dc575b308d77636c7169104e18714f03961a8',
    size: 161750089,
    files: {
      'nvidia/cu13/lib/libcufft.so.12': {
        name: 'libcufft.so.12',
        sha256: 'cebd2626d7f52996f0e3b7120828c7645396a1f2053cbb568ee77b80bfc414a7',
      },
    },
  },
  {
    id: 'nvidia-curand 10.4.4.72',
    url: `${PYPI}/07/73/3ee8e5b4cb891401e603ffd3a59b35c6afe785fd2de123afe7c7029603dc/nvidia_curand-10.4.4.72-py3-none-manylinux_2_27_x86_64.whl`,
    sha256: '25c3457ae7a224fdd484dab90b0fc5dc0e842fab5db3012afa4a5bd2af4eb7e5',
    size: 61498332,
    files: {
      'nvidia/cu13/lib/libcurand.so.10': {
        name: 'libcurand.so.10',
        sha256: '21bb4e5731e8bc3f1656b9c51f4a56ebcd27c3173e6ee80b82a2b3c0c8bd2473',
      },
    },
  },
  {
    id: 'nvidia-cuda-nvrtc 13.4.92',
    url: `${PYPI}/56/9c/1342ebb460ce2afd014ec5a002adc99108e3c53a6b70f399cf64dd1f267d/nvidia_cuda_nvrtc-13.4.92-py3-none-manylinux2010_x86_64.manylinux_2_12_x86_64.whl`,
    sha256: '5ce8c97b00b232c4f50c8c4b5a3b68cafee08bdb82ea86f2052ff01d03194f4a',
    size: 53301733,
    files: {
      'nvidia/cu13/lib/libnvrtc.so.13': {
        name: 'libnvrtc.so.13',
        sha256: 'd8f82e7019fe990bcd9efe4c5c444c036ddf2d5df95090d3965ae62be2009a2c',
      },
      'nvidia/cu13/lib/libnvrtc-builtins.so.13.4': {
        name: 'libnvrtc-builtins.so.13.4',
        sha256: '86414f3c350953a8a09de5eca9b9e8fe919d6289426c5ba9dbab365a3fe827d6',
      },
    },
  },
  {
    id: 'nvidia-cudnn-cu13 9.27.0.42',
    url: `${PYPI}/af/75/96ea5c5368eb595c39d629cde08a66227a864e71ccb0e593add2612bb952/nvidia_cudnn_cu13-9.27.0.42-py3-none-manylinux_2_27_x86_64.whl`,
    sha256: '9677e76f21862eb5da7ee5ed69d544738b2d8b5c3ce7e5ec125c5592e6cdbdc8',
    size: 536771498,
    files: Object.fromEntries(
      (
        [
          ['libcudnn.so.9', '4c3ccb552ee0c43aacca7498e12914fbda31be4fcb52cbdc1aaa87e78fb96e19'],
          ['libcudnn_adv.so.9', 'a82503cddeb8560597ad01e33a12df1845e94cf1d548733b40db11c5f0fb40ef'],
          ['libcudnn_cnn.so.9', '4ca0f1d4fbb79f3a428cf4c56b98001c3e02ee254793366a9b4dee6bd6688f38'],
          ['libcudnn_engines_precompiled.so.9', '0edc16383897f60dd4466776d2421d5351e023fd2950ac62bf5cf68ee399f42b'],
          ['libcudnn_engines_runtime_compiled.so.9', '334022cd6b47115ced9e3a289963d204705abfccefec052fd85234cb1d0e6355'],
          ['libcudnn_engines_tensor_ir.so.9', '4b47408d368863e5f37aeb019d8a05224213cf74335ce3ca6a8ba11d39ce70b3'],
          ['libcudnn_ext.so.9', 'baa699ebf17baa1bdb9c1720c373329a9caaab35d1050148d427186e1c7a7a00'],
          ['libcudnn_graph.so.9', '67df1f319154780e3ac7ef606d838c142b96f9c1b77e0ec95d7a5139d16e2800'],
          ['libcudnn_heuristic.so.9', 'a24474ae86db461aa5ab7cc2470fb9b88e09449d8bd6a8bba5d26eff20db2e29'],
          ['libcudnn_ops.so.9', 'd301a6ffb44b5d8cf04f67f3b49037e1a31801a5365892b03b74f171deba19e2'],
        ] as const
      ).map(([name, sha256]) => [`nvidia/cudnn/lib/${name}`, { name, sha256 }]),
    ),
  },
  {
    id: 'Microsoft.ML.OnnxRuntime.Gpu.Linux 1.27.0',
    url: 'https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime.gpu.linux/1.27.0/microsoft.ml.onnxruntime.gpu.linux.1.27.0.nupkg',
    sha256: 'b3c00b65eabf9d17ee038f49fae4f126cd28c0ccfc91deab556307497c71ee7b',
    size: 211908180,
    files: {
      'runtimes/linux-x64/native/libonnxruntime_providers_cuda.so': {
        name: 'libonnxruntime_providers_cuda.so',
        sha256: '0d3171e422fc7b554cb05af69009b519beec03d6084ebe924782307b29338f39',
      },
    },
  },
]
export const CUDA_LICENSES = [
  { name: 'NVIDIA CUDA', url: 'https://docs.nvidia.com/cuda/eula/index.html' },
  { name: 'NVIDIA cuDNN', url: 'https://docs.nvidia.com/deeplearning/cudnn/latest/reference/eula.html' },
  { name: 'ONNX Runtime (MIT)', url: 'https://github.com/microsoft/onnxruntime/blob/main/LICENSE' },
]
/** O CUDA 13 pede driver NVIDIA 580 ou mais novo. */
export const MIN_DRIVER = 580
const KEY = 'koma:cuda:v1'
// Espaço ocupado depois de extrair (bibliotecas da NVIDIA + provider do onnxruntime), medido.
const INSTALLED_BYTES = 2_280_000_000

/** Pasta do complemento: ao lado da biblioteca (~/.local/share/koma/cuda no Linux). */
export function cudaDir(env: NodeJS.ProcessEnv = process.env) {
  if (env.KOMA_CUDA_DIR) return env.KOMA_CUDA_DIR
  return env.KOMA_DATA_DIR ? path.join(path.dirname(env.KOMA_DATA_DIR), 'cuda') : path.join(os.homedir(), '.local/share/koma/cuda')
}

/** Versão principal do driver NVIDIA em /proc/driver/nvidia/version ("... Module ... 615.78.08 ..."). */
export function parseDriverVersion(text: string) {
  const match = text.match(/(?:Kernel Module|Open Kernel Module)[^\d]*?(\d{3,})\.\d+/) || text.match(/\b(\d{3,})\.\d+\.\d+\b/)
  return match ? Number(match[1]) : null
}
export function nvidiaDriver(read: () => string = () => fs.readFileSync('/proc/driver/nvidia/version', 'utf8')) {
  try {
    return parseDriverVersion(read())
  } catch {
    return null
  }
}
/** Onde o complemento pode ser oferecido: Linux x64 com driver NVIDIA compatível. */
export function cudaSupport(platform: string, arch: string, driver: number | null): { supported: boolean; reason: string | null } {
  if (platform !== 'linux' || arch !== 'x64') return { supported: false, reason: 'platform' }
  if (driver === null) return { supported: false, reason: 'no-nvidia' }
  if (driver < MIN_DRIVER) return { supported: false, reason: 'old-driver' }
  return { supported: true, reason: null }
}

// Arquivos conferidos: o hash de cada um é guardado com tamanho e data, para não reler
// 2 GB a cada consulta; arquivo mudado é conferido de novo.
type Stamp = Record<string, { size: number; mtimeMs: number; sha256: string }>
const stampFile = (dir: string) => path.join(dir, 'lib', '.conferidos.json')
function readStamp(dir: string): Stamp {
  try {
    return JSON.parse(fs.readFileSync(stampFile(dir), 'utf8')) as Stamp
  } catch {
    return {}
  }
}
async function sha256File(file: string) {
  const hash = crypto.createHash('sha256')
  await pipeline(fs.createReadStream(file), hash)
  return hash.digest('hex')
}
/** Confere (com o carimbo) os arquivos de um pacote já extraídos na pasta. */
async function packageReady(dir: string, pkg: CudaPackage, stamp: Stamp, rehash: boolean) {
  for (const file of Object.values(pkg.files)) {
    const full = path.join(dir, 'lib', file.name)
    let stat: fs.Stats
    try {
      stat = fs.statSync(full)
    } catch {
      return false
    }
    const known = stamp[file.name]
    if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs && known.sha256 === file.sha256) continue
    if (!rehash) return false
    if ((await sha256File(full)) !== file.sha256) return false
    stamp[file.name] = { size: stat.size, mtimeMs: stat.mtimeMs, sha256: file.sha256 }
  }
  return true
}
/** Pacotes que ainda faltam (com rehash, confere de verdade os arquivos que já existem). */
export async function missingPackages(dir: string, rehash = false, packages = CUDA_PACKAGES) {
  const stamp = readStamp(dir)
  const missing: CudaPackage[] = []
  for (const pkg of packages) if (!(await packageReady(dir, pkg, stamp, rehash))) missing.push(pkg)
  if (rehash) {
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true })
    fs.writeFileSync(stampFile(dir), JSON.stringify(stamp))
  }
  return missing
}

/**
 * Baixa um arquivo grande em partes paralelas (Range), retomável: as partes prontas
 * ficam anotadas ao lado do arquivo parcial. Confere o SHA-256 no fim.
 */
export async function downloadFile(
  url: string,
  target: string,
  size: number,
  sha256: string,
  options: {
    signal?: AbortSignal
    onProgress?: (bytes: number) => void
    connections?: number
    chunk?: number
    fetchImpl?: typeof fetch
  } = {},
) {
  const { signal, onProgress, connections = 8, chunk = 16 * 1024 * 1024, fetchImpl = fetch } = options
  const partial = `${target}.partial`
  const partsFile = `${target}.partes.json`
  const count = Math.max(1, Math.ceil(size / chunk))
  let done = new Set<number>()
  try {
    if (fs.existsSync(partial) && fs.statSync(partial).size === size)
      done = new Set(JSON.parse(fs.readFileSync(partsFile, 'utf8')) as number[])
  } catch {
    done = new Set()
  }
  if (!done.size) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(partial, '')
    fs.truncateSync(partial, size)
  }
  const handle = await fs.promises.open(partial, 'r+')
  let reported = [...done].reduce((sum, index) => sum + Math.min(chunk, size - index * chunk), 0)
  onProgress?.(reported)
  let next = 0
  const save = () => fs.writeFileSync(partsFile, JSON.stringify([...done]))
  try {
    await Promise.all(
      Array.from({ length: Math.min(connections, count) }, async () => {
        for (;;) {
          while (next < count && done.has(next)) next++
          if (next >= count) return
          const index = next++
          const start = index * chunk
          const end = Math.min(size, start + chunk) - 1
          const response = await fetchImpl(url, { headers: { Range: `bytes=${start}-${end}` }, signal })
          if (response.status !== 206 || !response.body)
            throw new Error(`O servidor não aceitou o download em partes (HTTP ${response.status}).`)
          let position = start
          const reader = response.body.getReader()
          for (;;) {
            const { done: finished, value } = await reader.read()
            if (finished) break
            await handle.write(value, 0, value.length, position)
            position += value.length
            reported += value.length
            onProgress?.(reported)
          }
          if (position !== end + 1) throw new Error('Download interrompido no meio de uma parte.')
          done.add(index)
          save()
        }
      }),
    )
  } finally {
    await handle.close()
  }
  if ((await sha256File(partial)) !== sha256) {
    fs.rmSync(partial, { force: true })
    fs.rmSync(partsFile, { force: true })
    throw new Error(`Arquivo baixado não confere (SHA-256): ${path.basename(target)}`)
  }
  fs.renameSync(partial, target)
  fs.rmSync(partsFile, { force: true })
}

/** Extrai do zip (wheel ou nupkg) só os arquivos pedidos, conferindo o SHA-256 de cada um. */
export async function extractZip(zipFile: string, wanted: Record<string, CudaFile>, outDir: string) {
  const handle = await fs.promises.open(zipFile, 'r')
  try {
    const { size } = await handle.stat()
    const tailSize = Math.min(size, 65557)
    const tail = Buffer.alloc(tailSize)
    await handle.read(tail, 0, tailSize, size - tailSize)
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    if (eocd < 0) throw new Error('Pacote zip inválido.')
    const entries = tail.readUInt16LE(eocd + 10)
    const cdSize = tail.readUInt32LE(eocd + 12)
    const cdOffset = tail.readUInt32LE(eocd + 16)
    if (cdOffset === 0xffffffff) throw new Error('Pacote zip64 não suportado.')
    const cd = Buffer.alloc(cdSize)
    await handle.read(cd, 0, cdSize, cdOffset)
    const found = new Set<string>()
    fs.mkdirSync(outDir, { recursive: true })
    for (let offset = 0, i = 0; i < entries; i++) {
      if (cd.readUInt32LE(offset) !== 0x02014b50) throw new Error('Diretório do zip inválido.')
      const method = cd.readUInt16LE(offset + 10)
      const compressed = cd.readUInt32LE(offset + 20)
      const nameLength = cd.readUInt16LE(offset + 28)
      const extraLength = cd.readUInt16LE(offset + 30)
      const commentLength = cd.readUInt16LE(offset + 32)
      const local = cd.readUInt32LE(offset + 42)
      const name = cd.toString('utf8', offset + 46, offset + 46 + nameLength)
      offset += 46 + nameLength + extraLength + commentLength
      const file = wanted[name]
      if (!file) continue
      if (compressed === 0xffffffff || local === 0xffffffff) throw new Error('Pacote zip64 não suportado.')
      const header = Buffer.alloc(30)
      await handle.read(header, 0, 30, local)
      const start = local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
      const target = path.join(outDir, file.name)
      const hash = crypto.createHash('sha256')
      const tap = new Transform({
        transform(data, _encoding, callback) {
          hash.update(data)
          callback(null, data)
        },
      })
      const source = fs.createReadStream(zipFile, { start, end: start + compressed - 1 })
      if (method === 8) await pipeline(source, zlib.createInflateRaw(), tap, fs.createWriteStream(`${target}.partial`))
      else if (method === 0) await pipeline(source, tap, fs.createWriteStream(`${target}.partial`))
      else throw new Error(`Compressão não suportada no zip (${method}).`)
      if (hash.digest('hex') !== file.sha256) {
        fs.rmSync(`${target}.partial`, { force: true })
        throw new Error(`Arquivo extraído não confere (SHA-256): ${file.name}`)
      }
      fs.chmodSync(`${target}.partial`, 0o755)
      fs.renameSync(`${target}.partial`, target)
      found.add(name)
    }
    const absent = Object.keys(wanted).filter((name) => !found.has(name))
    if (absent.length) throw new Error(`Faltam arquivos no pacote: ${absent.join(', ')}`)
  } finally {
    await handle.close()
  }
}

// Estado do download (um por processo).
type Job = { running: boolean; phase: string; done: number; total: number; error: string; controller: AbortController | null }
const job: Job = ((globalThis as typeof globalThis & { __komaCuda?: Job }).__komaCuda ||= {
  running: false,
  phase: '',
  done: 0,
  total: 0,
  error: '',
  controller: null,
})

interface Settings {
  enabled: boolean
  accepted: boolean
}
export function cudaSettings(database: Database.Database): Settings {
  const row = database.prepare('SELECT value FROM kv_store WHERE key = ?').get(KEY) as { value: string } | undefined
  try {
    const value = row ? (JSON.parse(row.value) as Partial<Settings>) : {}
    return { enabled: value.enabled === true, accepted: value.accepted === true }
  } catch {
    return { enabled: false, accepted: false }
  }
}
function saveSettings(database: Database.Database, settings: Settings) {
  database
    .prepare(
      `INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = NULL`,
    )
    .run(KEY, JSON.stringify(settings))
}

// Instalação completa? (só pelo carimbo, sem reler os arquivos; atualizada a cada 30 s).
let readyCache = { at: 0, dir: '', ready: false }
export async function cudaInstalled(dir = cudaDir()) {
  if (readyCache.dir === dir && Date.now() - readyCache.at < 30000) return readyCache.ready
  const ready = (await missingPackages(dir)).length === 0
  readyCache = { at: Date.now(), dir, ready }
  return ready
}
/** O desenho deve usar CUDA agora? (complemento instalado, ligado e máquina compatível) */
export async function cudaActive(database: Database.Database, dir = cudaDir()) {
  return (
    cudaSettings(database).enabled && cudaSupport(process.platform, process.arch, nvidiaDriver()).supported && (await cudaInstalled(dir))
  )
}

function freeBytes(dir: string) {
  for (let current = dir; ; current = path.dirname(current)) {
    try {
      const stat = fs.statfsSync(current)
      return stat.bavail * stat.bsize
    } catch {
      if (path.dirname(current) === current) return null
    }
  }
}

export async function cudaStatus(database: Database.Database, dir = cudaDir()) {
  const driver = nvidiaDriver()
  const support = cudaSupport(process.platform, process.arch, driver)
  // Arquivos já na pasta sem conferência anotada (cópia manual, carimbo apagado): confere uma vez.
  const present = CUDA_PACKAGES.every((pkg) => Object.values(pkg.files).every((file) => fs.existsSync(path.join(dir, 'lib', file.name))))
  const missing = job.running ? CUDA_PACKAGES : await missingPackages(dir, present && !fs.existsSync(stampFile(dir)))
  const installed = !job.running && missing.length === 0
  return {
    ...support,
    driver,
    installed,
    ...cudaSettings(database),
    downloadBytes: missing.reduce((sum, pkg) => sum + pkg.size, 0),
    diskBytes: INSTALLED_BYTES,
    freeBytes: freeBytes(dir),
    dir,
    licenses: CUDA_LICENSES,
    job: { running: job.running, phase: job.phase, done: job.done, total: job.total, error: job.error },
  }
}

/** Baixa e extrai o que falta; o usuário precisa ter aceitado as licenças. */
export async function installCuda(database: Database.Database, dir = cudaDir(), packages = CUDA_PACKAGES, fetchImpl: typeof fetch = fetch) {
  if (job.running) return
  const settings = cudaSettings(database)
  if (!settings.accepted) throw new Error('É preciso aceitar as licenças da NVIDIA antes de baixar.')
  const controller = new AbortController()
  Object.assign(job, { running: true, phase: 'checking', done: 0, total: 0, error: '', controller })
  try {
    const missing = await missingPackages(dir, true, packages)
    job.total = missing.reduce((sum, pkg) => sum + pkg.size, 0)
    const downloads = path.join(dir, 'downloads')
    let finished = 0
    for (const pkg of missing) {
      job.phase = 'downloading'
      const file = path.join(downloads, path.basename(new URL(pkg.url).pathname))
      if (!fs.existsSync(file))
        await downloadFile(pkg.url, file, pkg.size, pkg.sha256, {
          signal: controller.signal,
          fetchImpl,
          onProgress: (bytes) => {
            job.done = finished + bytes
          },
        })
      finished += pkg.size
      job.done = finished
      job.phase = 'extracting'
      await extractZip(file, pkg.files, path.join(dir, 'lib'))
      fs.rmSync(file, { force: true })
    }
    job.phase = 'checking'
    const left = await missingPackages(dir, true, packages)
    if (left.length) throw new Error(`A instalação não terminou: ${left.map((pkg) => pkg.id).join(', ')}`)
    fs.rmSync(downloads, { recursive: true, force: true })
    readyCache = { at: 0, dir: '', ready: false }
    saveSettings(database, { ...cudaSettings(database), enabled: true })
    job.phase = 'done'
  } catch (error) {
    job.error = controller.signal.aborted ? 'canceled' : error instanceof Error ? error.message : String(error)
    job.phase = 'error'
  } finally {
    job.running = false
    job.controller = null
  }
}
export function cancelCudaInstall() {
  job.controller?.abort()
}
export function acceptCudaLicenses(database: Database.Database) {
  saveSettings(database, { ...cudaSettings(database), accepted: true })
}
export function setCudaEnabled(database: Database.Database, enabled: boolean) {
  saveSettings(database, { ...cudaSettings(database), enabled })
}
/** Remove o complemento e libera o espaço (o desenho volta para o WebGPU). */
export function removeCuda(database: Database.Database, dir = cudaDir()) {
  if (job.running) throw new Error('Cancele o download antes de remover.')
  saveSettings(database, { ...cudaSettings(database), enabled: false })
  // Só apaga uma pasta chamada "cuda", nunca outra coisa por engano de configuração.
  if (path.basename(dir) !== 'cuda') throw new Error('Pasta do complemento inesperada.')
  fs.rmSync(dir, { recursive: true, force: true })
  readyCache = { at: 0, dir: '', ready: false }
}
