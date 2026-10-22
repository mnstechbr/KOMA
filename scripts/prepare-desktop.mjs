import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { verifyModels } from './desktop-models.mjs'
import { buildMlWorker } from './build-ml-worker.mjs'

const root = path.resolve(import.meta.dirname, '..')
const target = path.resolve(root, 'artifacts', `koma-${Date.now()}`)
const standalone = path.join(root, '.next/standalone')
const portableRoot = path.join(root, 'artifacts/runtimes/node-v24.18.0-linux-x64')
const portableNode = path.join(portableRoot, 'bin/node')
await fs.access(path.join(standalone, 'server.js'))
await fs.access(path.join(root, 'desktop/node_modules/electron/dist/electron'))
await fs.access(portableNode)
const abi = execFileSync(portableNode, ['-p', 'process.versions.modules'], { encoding: 'utf8' }).trim()
if (abi !== process.versions.modules) throw new Error('Construa com Node 24 para manter a ABI dos módulos nativos do pacote.')

const server = path.join(target, 'server')
await fs.mkdir(server, { recursive: true })
// Lista explícita impede empacotar storage, .env, código-fonte ou artefatos capturados pelo tracing.
for (const entry of ['.next', 'node_modules', 'package.json', 'server.js']) {
  await fs.cp(path.join(standalone, entry), path.join(server, entry), { recursive: true, verbatimSymlinks: true })
}
await fs.copyFile(path.join(root, 'package.json'), path.join(server, 'package.json'))
for (const entry of ['public', 'models']) {
  await fs.cp(path.join(root, entry), path.join(server, entry), { recursive: true, verbatimSymlinks: true })
}
await fs.cp(path.join(root, '.next/static'), path.join(server, '.next/static'), { recursive: true, verbatimSymlinks: true })
// OCR e apagamento num processo separado (worker thread), fora da thread das telas.
await fs.cp(await buildMlWorker(), path.join(server, 'koma-ml'), { recursive: true })
for (const name of ['sharp', 'onnxruntime-node', 'better-sqlite3']) {
  await fs.cp(path.join(root, 'node_modules', name), path.join(server, 'node_modules', name), {
    recursive: true,
    verbatimSymlinks: true,
    filter: (source) => {
      if (name !== 'onnxruntime-node') return true
      const relative = path
        .relative(path.join(root, 'node_modules', name), source)
        .split(path.sep)
        .join('/')
      if (/bin\/napi-v6\/(win32|darwin)/.test(relative) || /bin\/napi-v6\/linux\/(arm64|arm)/.test(relative)) return false
      return !/libonnxruntime_providers_(cuda|tensorrt)\.so$/.test(relative)
    },
  })
}
await verifyModels(root, path.join(server, 'models'))
await fs.cp(path.join(root, 'desktop/node_modules/electron/dist'), path.join(target, 'electron'), {
  recursive: true,
  verbatimSymlinks: true,
})
const electronApp = path.join(target, 'electron/resources/app')
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
await fs.mkdir(path.join(target, 'runtime'), { recursive: true })
await fs.copyFile(portableNode, path.join(target, 'runtime/node'))
await fs.copyFile(path.join(portableRoot, 'LICENSE'), path.join(target, 'runtime/LICENSE-Node'))
await fs.copyFile(path.join(root, 'LICENSE'), path.join(target, 'LICENSE'))
await fs.copyFile(path.join(root, 'THIRD-PARTY-NOTICES'), path.join(target, 'THIRD-PARTY-NOTICES'))
await fs.writeFile(
  path.join(target, 'LEIA-ME.txt'),
  'KOMA — baseado em translate-manga-br (MIT).\nUso pessoal local. Modelos originais preservados; verifique as licenças dos pesos antes de redistribuir.\nDados: ~/.local/share/koma/library. Diagnóstico: ~/.local/state/koma/logs.\n',
)
await fs.writeFile(
  path.join(target, 'koma'),
  '#!/usr/bin/env bash\nset -euo pipefail\nKOMA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\nunset ELECTRON_RUN_AS_NODE\nexec "$KOMA_ROOT/electron/electron" "$KOMA_ROOT/electron/resources/app" "$@"\n',
  { mode: 0o755 },
)
async function verifyLinks(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) await verifyLinks(file)
    if (entry.isSymbolicLink()) {
      const resolved = await fs.realpath(file)
      if (!resolved.startsWith(`${target}${path.sep}`)) throw new Error(`Link fora do pacote: ${file}`)
    }
  }
}
await verifyLinks(target)
await fs.writeFile(path.join(root, 'artifacts/latest-bundle.txt'), `${target}\n`)
console.log(`Pacote pronto: ${target}`)
