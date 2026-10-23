import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { packagedModel, verifyModels } from './desktop-models.mjs'
import { buildMlWorker } from './build-ml-worker.mjs'

// Monta o pacote do KOMA para Windows 11 (x64) e o instalador .exe (NSIS).
// Roda no Linux ou no Windows: usa o build do Next já feito (npm run build) e
// troca os módulos nativos pelas versões win32-x64, todas com hash conferido.
const root = path.resolve(import.meta.dirname, '..')
const cache = path.join(root, 'artifacts/runtimes/win32-x64')
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version
const nodeVersion = '24.18.0'
const nodeAbi = '137'
const pinned = {
  electron: { version: '44.9.0', sha256: '88e08039d0ef359bab9f674e8051fa103bd8628ea7c5a5e1daaa610a8a0c6931' },
  'better-sqlite3': { version: '12.10.0', sha256: '0f6d948e6438f64c983d08a2048ef10d6f467f36a8c08f20d31f585c019eb83c' },
  sharp: { version: '0.32.6', sha256: '910ea72076e7d2334d492ad2d94f8bfbf740bf8adf175b30db748303432f1814' },
  nsis: { version: '3.0.5.0', sha256: '44755ffcf6401ef358369fa80fb4351d7d0d649d8d3deda39a8d29035cbb9747' },
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex')
const moduleVersion = async (dir) => JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')).version
// No Windows, o tar do sistema (bsdtar); o GNU tar do Git leria C: como host remoto.
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
const run = (file, args, options = {}) => execFileSync(file, args, { stdio: ['ignore', 'ignore', 'inherit'], ...options })

async function fetchVerified(url, name, check) {
  const file = path.join(cache, name)
  const cached = await fs.readFile(file).catch(() => null)
  if (cached && check(cached)) return file
  console.log(`Baixando ${name}…`)
  const response = await fetch(url, { signal: AbortSignal.timeout(600000) })
  if (!response.ok) throw new Error(`Download falhou (${name}): HTTP ${response.status}`)
  const data = Buffer.from(await response.arrayBuffer())
  if (!check(data)) throw new Error(`Hash inválido: ${name}`)
  await fs.writeFile(`${file}.partial`, data)
  await fs.rename(`${file}.partial`, file)
  return file
}
const pin = (hash) => (data) => sha256(data) === hash

// Versões precisam bater com as usadas no build; senão o hash fixado está velho.
const desktopPkg = JSON.parse(await fs.readFile(path.join(root, 'desktop/package.json'), 'utf8'))
for (const [name, dir] of [
  ['electron', null],
  ['better-sqlite3', 'node_modules/better-sqlite3'],
  ['sharp', 'node_modules/sharp'],
]) {
  const installed = dir ? await moduleVersion(path.join(root, dir)) : desktopPkg.devDependencies.electron
  if (installed !== pinned[name].version)
    throw new Error(
      `${name} ${installed} instalado, mas o pacote Windows está fixado em ${pinned[name].version}. Atualize o hash em scripts/build-windows.mjs.`,
    )
}
const standalone = path.join(root, '.next/standalone')
await fs.access(path.join(standalone, 'server.js')).catch(() => {
  throw new Error('Rode npm run build antes.')
})
await fs.mkdir(cache, { recursive: true })

const nodeSums = await (
  await fetch(`https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`, { signal: AbortSignal.timeout(60000) })
).text()
const nodeZipName = `node-v${nodeVersion}-win-x64.zip`
const nodeHash = nodeSums
  .split('\n')
  .find((line) => line.endsWith(`  ${nodeZipName}`))
  ?.split(/\s+/)[0]
if (!nodeHash) throw new Error('Checksum do Node indisponível.')
const nodeZip = await fetchVerified(`https://nodejs.org/dist/v${nodeVersion}/${nodeZipName}`, nodeZipName, pin(nodeHash))
const electronZip = await fetchVerified(
  `https://github.com/electron/electron/releases/download/v${pinned.electron.version}/electron-v${pinned.electron.version}-win32-x64.zip`,
  `electron-v${pinned.electron.version}-win32-x64.zip`,
  pin(pinned.electron.sha256),
)
const sqliteTar = await fetchVerified(
  `https://github.com/WiseLibs/better-sqlite3/releases/download/v${pinned['better-sqlite3'].version}/better-sqlite3-v${pinned['better-sqlite3'].version}-node-v${nodeAbi}-win32-x64.tar.gz`,
  `better-sqlite3-v${pinned['better-sqlite3'].version}-node-v${nodeAbi}-win32-x64.tar.gz`,
  pin(pinned['better-sqlite3'].sha256),
)
const sharpTar = await fetchVerified(
  `https://github.com/lovell/sharp/releases/download/v${pinned.sharp.version}/sharp-v${pinned.sharp.version}-napi-v7-win32-x64.tar.gz`,
  `sharp-v${pinned.sharp.version}-napi-v7-win32-x64.tar.gz`,
  pin(pinned.sharp.sha256),
)
// O libvips usa o hash SHA-512 que o próprio sharp publica no package.json.
const sharpConfig = JSON.parse(await fs.readFile(path.join(root, 'node_modules/sharp/package.json'), 'utf8')).config
const vipsIntegrity = sharpConfig.integrity['win32-x64']
const vipsTar = await fetchVerified(
  `https://github.com/lovell/sharp-libvips/releases/download/v${sharpConfig.libvips}/libvips-${sharpConfig.libvips}-win32-x64.tar.br`,
  `libvips-${sharpConfig.libvips}-win32-x64.tar.br`,
  (data) => `sha512-${crypto.createHash('sha512').update(data).digest('base64')}` === vipsIntegrity,
)
const nsisArchive = await fetchVerified(
  `https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-${pinned.nsis.version}/nsis-${pinned.nsis.version}.7z`,
  `nsis-${pinned.nsis.version}.7z`,
  pin(pinned.nsis.sha256),
)

const target = path.join(root, 'artifacts', `koma-win32-x64-${version}-${Date.now()}`)
const work = path.join(target, '.work')
await fs.mkdir(work, { recursive: true })
const extract = async (archive, dir) => {
  await fs.mkdir(dir, { recursive: true })
  run('7z', ['x', '-y', `-o${dir}`, archive])
}
const untar = async (archive, dir) => {
  await fs.mkdir(dir, { recursive: true })
  run(tar, ['-xzf', archive, '-C', dir])
}

// Servidor: mesma lista explícita do pacote Linux (sem storage, .env ou código-fonte).
const server = path.join(target, 'server')
await fs.mkdir(server, { recursive: true })
for (const entry of ['.next', 'node_modules', 'package.json', 'server.js']) {
  await fs.cp(path.join(standalone, entry), path.join(server, entry), { recursive: true, verbatimSymlinks: true })
}
await fs.copyFile(path.join(root, 'package.json'), path.join(server, 'package.json'))
for (const entry of ['public', 'models'])
  await fs.cp(path.join(root, entry), path.join(server, entry), {
    recursive: true,
    filter: (source) => packagedModel(path.basename(source)),
  })
await fs.cp(path.join(root, '.next/static'), path.join(server, '.next/static'), { recursive: true })
// OCR e apagamento num processo separado (worker thread), fora da thread das telas.
await fs.cp(await buildMlWorker(), path.join(server, 'koma-ml'), { recursive: true })
await verifyModels(root, path.join(server, 'models'))

// Módulos nativos: código JS do npm, binários win32-x64.
const nativeDir = (name) => path.join(server, 'node_modules', name)
const skip = {
  'better-sqlite3': /^(build|deps|src)(\/|$)/,
  sharp: /^(build|vendor|src)(\/|$)/,
  'onnxruntime-node': /^bin\/napi-v6\/(linux|darwin)(\/|$)/,
}
for (const name of Object.keys(skip)) {
  await fs.rm(nativeDir(name), { recursive: true, force: true })
  await fs.cp(path.join(root, 'node_modules', name), nativeDir(name), {
    recursive: true,
    filter: (source) =>
      !skip[name].test(
        path
          .relative(path.join(root, 'node_modules', name), source)
          .split(path.sep)
          .join('/'),
      ),
  })
}
await fs.access(path.join(nativeDir('onnxruntime-node'), 'bin/napi-v6/win32/x64/onnxruntime_binding.node'))
await untar(sqliteTar, nativeDir('better-sqlite3'))
await untar(sharpTar, nativeDir('sharp'))
const vips = path.join(work, 'libvips')
await fs.mkdir(vips, { recursive: true })
await fs.writeFile(path.join(work, 'libvips.tar'), zlib.brotliDecompressSync(await fs.readFile(vipsTar)))
run(tar, ['-xf', path.join(work, 'libvips.tar'), '-C', vips])
for (const dll of (await fs.readdir(path.join(vips, 'lib'))).filter((file) => file.endsWith('.dll'))) {
  await fs.copyFile(path.join(vips, 'lib', dll), path.join(nativeDir('sharp'), 'build/Release', dll))
}
// O sharp interno do Next só serve para otimizar imagens, desligado no KOMA.
await fs.rm(path.join(server, 'node_modules/next/node_modules/@img'), { recursive: true, force: true })

// O Turbopack aponta para os pacotes externos por links simbólicos com hash,
// que o instalador não recria no Windows. Um pacote mínimo faz o mesmo papel.
const hashed = path.join(server, '.next/node_modules')
for (const entry of await fs.readdir(hashed).catch(() => [])) {
  const real = entry.replace(/-[0-9a-f]{16}$/, '')
  if (!Object.hasOwn(skip, real)) throw new Error(`Módulo externo inesperado: ${entry}`)
  await fs.rm(path.join(hashed, entry), { recursive: true, force: true })
  await fs.mkdir(path.join(hashed, entry))
  await fs.writeFile(path.join(hashed, entry, 'package.json'), `${JSON.stringify({ name: entry, private: true, main: 'index.js' })}\n`)
  await fs.writeFile(path.join(hashed, entry, 'index.js'), `module.exports = require(${JSON.stringify(real)})\n`)
}

// Electron renomeado para KOMA.exe; o app fica em resources/app como no Linux.
const electron = path.join(target, 'electron')
await extract(electronZip, electron)
await fs.rename(path.join(electron, 'electron.exe'), path.join(electron, 'KOMA.exe'))
await fs.rm(path.join(electron, 'resources/default_app.asar'), { force: true })
const electronApp = path.join(electron, 'resources/app')
await fs.mkdir(electronApp, { recursive: true })
for (const name of [
  'main.cjs',
  'background.cjs',
  'mobile-server.cjs',
  'external-links.cjs',
  'paths.cjs',
  'backend.cjs',
  'supervisor.cjs',
  'window-checks.cjs',
  'package.json',
  'koma.png',
]) {
  await fs.copyFile(path.join(root, 'desktop', name), path.join(electronApp, name))
}

const nodeDir = path.join(work, 'node')
await extract(nodeZip, nodeDir)
await fs.mkdir(path.join(target, 'runtime'), { recursive: true })
await fs.copyFile(path.join(nodeDir, `node-v${nodeVersion}-win-x64/node.exe`), path.join(target, 'runtime/node.exe'))
await fs.copyFile(path.join(nodeDir, `node-v${nodeVersion}-win-x64/LICENSE`), path.join(target, 'runtime/LICENSE-Node'))
await fs.copyFile(path.join(root, 'LICENSE'), path.join(target, 'LICENSE'))
await fs.copyFile(path.join(root, 'THIRD-PARTY-NOTICES'), path.join(target, 'THIRD-PARTY-NOTICES'))
await fs.copyFile(path.join(root, 'desktop/koma.ico'), path.join(target, 'koma.ico'))
await fs.writeFile(
  path.join(target, 'LEIA-ME.txt'),
  'KOMA — licença AGPL-3.0-or-later (LICENSE), baseado em translate-manga-br (MIT).\r\nUso pessoal local. Licenças dos modelos em THIRD-PARTY-NOTICES.\r\nDados: %LOCALAPPDATA%\\KOMA\\library. Diagnóstico: %LOCALAPPDATA%\\KOMA\\logs.\r\n',
)

// O Windows recusa estes caracteres em nomes; o NSIS falharia só na instalação.
async function checkTree(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (/[<>:"|?*\\]/.test(entry.name)) throw new Error(`Nome inválido no Windows: ${path.join(dir, entry.name)}`)
    if (entry.isSymbolicLink()) throw new Error(`Link simbólico no pacote Windows: ${path.join(dir, entry.name)}`)
    if (entry.isDirectory() && entry.name !== '.work') await checkTree(path.join(dir, entry.name))
  }
}
await checkTree(target)

const nsis = path.join(cache, `nsis-${pinned.nsis.version}`)
await fs.access(path.join(nsis, 'Include')).catch(() => extract(nsisArchive, nsis))
const makensis =
  process.platform === 'win32'
    ? path.join(nsis, 'Bin/makensis.exe')
    : path.join(nsis, `${process.platform === 'darwin' ? 'mac' : 'linux'}/makensis`)
if (process.platform !== 'win32') await fs.chmod(makensis, 0o755)
await fs.rm(work, { recursive: true, force: true })
const output = path.join(root, 'artifacts', `KOMA-Setup-${version}.exe`)
console.log('Gerando instalador…')
run(makensis, ['-V2', `-DVERSION=${version}`, `-DBUNDLE=${target}`, `-DOUTFILE=${output}`, path.join(root, 'desktop/windows/koma.nsi')], {
  env: { ...process.env, NSISDIR: nsis },
  stdio: ['ignore', 'inherit', 'inherit'],
})
console.log(`Instalador pronto: ${output}`)
