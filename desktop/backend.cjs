const { spawn } = require('node:child_process')
const net = require('node:net')
const path = require('node:path')
const crypto = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function stopProcess(child, timeout = 5000) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  if (process.platform === 'win32') {
    // No Windows não há SIGTERM: matar só o supervisor deixaria o servidor órfão
    // segurando o banco e a porta. O taskkill /T encerra a árvore inteira.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).once('error', () => child.kill())
    await Promise.race([exited, delay(timeout)])
    return
  }
  child.kill('SIGTERM')
  let timer
  await Promise.race([exited, new Promise((resolve) => { timer = setTimeout(resolve, timeout) })])
  clearTimeout(timer)
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await exited
  }
}

async function startBackend({ nodePath, serverDir, dataDir, logFd, parentPid = process.pid, timeout = 30000, automation = true }) {
  const port = await freePort()
  const instance = crypto.randomUUID()
  const bootstrapToken = crypto.randomBytes(32).toString('hex')
  const url = `http://127.0.0.1:${port}`
  const child = spawn(nodePath, [path.join(__dirname, 'supervisor.cjs'), String(parentPid), serverDir], {
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
    env: {
      ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port),
      KOMA_DESKTOP: '1', KOMA_DATA_DIR: dataDir, KOMA_INSTANCE_ID: instance,
      KOMA_BOOTSTRAP_TOKEN: bootstrapToken,
      NEXT_TELEMETRY_DISABLED: '1', SECTION_IMAGE_PROCESSING_CONCURRENCY: '2',
      SKIP_DB_BOOTSTRAP: '0', ELECTRON_RUN_AS_NODE: '',
      KOMA_AUTOMATION_DISABLED: automation ? '0' : '1',
    },
  })
  let spawnError
  child.on('error', (error) => { spawnError = error })
  const deadline = Date.now() + timeout
  try {
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('O serviço local encerrou durante a inicialização.')
      try {
        const response = await fetch(`${url}/api/local/health`, { signal: AbortSignal.timeout(1000) })
        const health = await response.json()
        if (response.ok && health.application === 'KOMA' && health.instance === instance) {
          return {
            child, url, stop: () => stopProcess(child),
            bootstrap: async () => {
              const response = await fetch(`${url}/api/local/bootstrap`, {
                method: 'POST', headers: { 'x-koma-bootstrap-token': bootstrapToken, Origin: url },
                signal: AbortSignal.timeout(15000),
              })
              if (!response.ok) throw new Error('Não foi possível abrir sua biblioteca local.')
              const data = await response.json()
              if (typeof data.sessionToken !== 'string' || !data.sessionToken) throw new Error('A sessão local não foi inicializada.')
              return data
            },
          }
        }
      } catch { /* O servidor ainda pode estar carregando migrations e bibliotecas. */ }
      await delay(100)
    }
    throw new Error('O serviço local não ficou pronto em 30 segundos. Consulte os logs do KOMA.')
  } catch (error) {
    await stopProcess(child)
    throw error
  }
}

module.exports = { startBackend, stopProcess }
