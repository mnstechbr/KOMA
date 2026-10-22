import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const manifest = path.join(root, 'artifacts/latest-bundle.txt')
if (!fs.existsSync(manifest)) throw new Error('Prepare o pacote com npm run desktop:prepare antes de iniciar.')
const bundle = fs.readFileSync(manifest, 'utf8').trim()
const child = spawn(path.join(bundle, 'koma'), [], { stdio: 'inherit', env: process.env })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.once('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.once('exit', (code) => {
  process.exitCode = code ?? 1
})
