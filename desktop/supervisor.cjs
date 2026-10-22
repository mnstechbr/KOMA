const { spawn } = require('node:child_process')
const path = require('node:path')

const parentPid = Number(process.argv[2])
const serverDir = process.argv[3]
const child = spawn(process.execPath, [path.join(serverDir, 'server.js')], {
  cwd: serverDir,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
})
let stopping = false
let forceTimer
function stop() {
  if (stopping) return
  stopping = true
  child.kill('SIGTERM')
  forceTimer = setTimeout(() => child.kill('SIGKILL'), 3500)
}
const watcher = setInterval(() => {
  try {
    process.kill(parentPid, 0)
  } catch {
    stop()
  }
}, 1000)
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
child.once('error', (error) => {
  console.error('Não foi possível iniciar o serviço local:', error.message)
  clearInterval(watcher)
  process.exitCode = 1
})
child.once('exit', (code) => {
  clearInterval(watcher)
  clearTimeout(forceTimer)
  process.exitCode = stopping ? 0 : code || 1
})
