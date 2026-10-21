import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const baseline = '9c7e2706d894a53df1a8bb0ccd6270a8196aaad5'
const nodeVersion = '24.18.0'
const root = path.resolve(import.meta.dirname, '..')

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) })
  if (!response.ok) throw new Error(`Download falhou: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

function validate(data, hash, name) {
  if (crypto.createHash('sha256').update(data).digest('hex') !== hash) throw new Error(`SHA-256 inválido: ${name}`)
}

for (const name of await fs.readdir(path.join(root, 'models'))) {
  let pointer
  try { pointer = execFileSync('git', ['show', `${baseline}:models/${name}`], { cwd: root, encoding: 'utf8' }) } catch { continue }
  const hash = pointer.match(/oid sha256:([a-f0-9]{64})/)?.[1]
  const size = Number(pointer.match(/size (\d+)/)?.[1])
  if (!hash) continue
  const target = path.join(root, 'models', name)
  const existing = await fs.readFile(target).catch(() => Buffer.alloc(0))
  if (existing.length === size && crypto.createHash('sha256').update(existing).digest('hex') === hash) continue
  console.log(`Baixando modelo ${name}…`)
  const data = await download(`https://media.githubusercontent.com/media/marco0antonio0/translate-manga-br/${baseline}/models/${name}`)
  validate(data, hash, name)
  if (data.length !== size) throw new Error(`Tamanho inválido: ${name}`)
  await fs.writeFile(`${target}.partial`, data)
  await fs.rename(`${target}.partial`, target)
}

// OCR coreano (PP-OCRv5, convertido para ONNX), com hash fixado.
const koreanModels = [
  ['paddleocr_v5_korean_rec.onnx', 'rec.onnx', '322f140154c820fcb83c3d24cfe42c9ec70dd1a1834163306a7338136e4f1eaa'],
  ['paddleocr_v5_korean_dict.txt', 'dict.txt', 'a88071c68c01707489baa79ebe0405b7beb5cca229f4fc94cc3ef992328802d7'],
]
for (const [name, remote, hash] of koreanModels) {
  const target = path.join(root, 'models', name)
  const existing = await fs.readFile(target).catch(() => Buffer.alloc(0))
  if (crypto.createHash('sha256').update(existing).digest('hex') === hash) continue
  console.log(`Baixando modelo ${name}…`)
  const data = await download(`https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/korean/${remote}`)
  validate(data, hash, name)
  await fs.writeFile(`${target}.partial`, data)
  await fs.rename(`${target}.partial`, target)
}

// Apagamento do texto original: o detector de letras marca os pixels da letra e o
// LaMa reconstrói o desenho por baixo. Hash fixado.
const inpaintModels = [
  ['comic-text-detector.onnx', 'https://huggingface.co/mayocream/comic-text-detector-onnx/resolve/main/comic-text-detector.onnx', '1a86ace74961413cbd650002e7bb4dcec4980ffa21b2f19b86933372071d718f'],
  ['lama_fp32.onnx', 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx', '1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6'],
]
for (const [name, url, hash] of inpaintModels) {
  const target = path.join(root, 'models', name)
  const existing = await fs.readFile(target).catch(() => Buffer.alloc(0))
  if (crypto.createHash('sha256').update(existing).digest('hex') === hash) continue
  console.log(`Baixando modelo ${name}…`)
  const data = await download(url)
  validate(data, hash, name)
  await fs.writeFile(`${target}.partial`, data)
  await fs.rename(`${target}.partial`, target)
}

// O runtime Node do pacote Linux; o do Windows vem em scripts/build-windows.mjs.
if (process.platform === 'linux' && process.arch === 'x64') {
  const runtimeRoot = path.join(root, 'artifacts/runtimes')
  const archive = `node-v${nodeVersion}-linux-x64.tar.xz`
  const baseUrl = `https://nodejs.org/dist/v${nodeVersion}/`
  console.log(`Verificando runtime Node ${nodeVersion}…`)
  const checks = (await download(`${baseUrl}SHASUMS256.txt`)).toString()
  const hash = checks.split('\n').find((line) => line.endsWith(`  ${archive}`))?.split(/\s+/)[0]
  if (!hash) throw new Error('Checksum do runtime indisponível.')
  const data = await download(`${baseUrl}${archive}`)
  validate(data, hash, archive)
  await fs.mkdir(runtimeRoot, { recursive: true })
  await fs.writeFile(path.join(runtimeRoot, archive), data)
  execFileSync('tar', ['-xJf', path.join(runtimeRoot, archive), '-C', runtimeRoot])
}
console.log('Modelos e runtime verificados. Nenhum conteúdo da biblioteca foi enviado.')
