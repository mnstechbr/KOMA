const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')
const { startBackend } = require('../backend.cjs')

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'koma-backend-'))
  fs.writeFileSync(
    path.join(root, 'server.js'),
    `
    const http = require('node:http');
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({application: 'KOMA', instance: process.env.KOMA_INSTANCE_ID, pid: process.pid}));
    });
    server.listen(Number(process.env.PORT), process.env.HOSTNAME);
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `,
  )
  return root
}

test('serviço local fica pronto, atende loopback e encerra toda a árvore', async () => {
  const root = fixture()
  const backend = await startBackend({ nodePath: process.execPath, serverDir: root, dataDir: root, logFd: 'ignore' })
  const data = await (await fetch(`${backend.url}/api/local/health`)).json()
  assert.match(backend.url, /^http:\/\/127\.0\.0\.1:/)
  await backend.stop()
  assert.throws(() => process.kill(data.pid, 0), { code: 'ESRCH' })
  await assert.rejects(fetch(backend.url))
  fs.rmSync(root, { recursive: true })
})

test('a perda do processo da janela encerra o backend', async () => {
  const root = fixture()
  const parent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
  const backend = await startBackend({ nodePath: process.execPath, serverDir: root, dataDir: root, logFd: 'ignore', parentPid: parent.pid })
  const data = await (await fetch(backend.url)).json()
  const parentExit = new Promise((resolve) => parent.once('exit', resolve))
  parent.kill('SIGTERM')
  await parentExit
  for (let attempt = 0; attempt < 30 && backend.child.exitCode === null; attempt++) await delay(100)
  assert.throws(() => process.kill(data.pid, 0), { code: 'ESRCH' })
  await backend.stop()
  fs.rmSync(root, { recursive: true })
})

test('falha de inicialização não deixa um processo supervisor ativo', async () => {
  const root = fixture()
  fs.writeFileSync(path.join(root, 'server.js'), 'process.exit(1)')
  await assert.rejects(startBackend({ nodePath: process.execPath, serverDir: root, dataDir: root, logFd: 'ignore' }), /encerrou/)
  await assert.rejects(startBackend({ nodePath: '/caminho-inexistente/node', serverDir: root, dataDir: root, logFd: 'ignore' }), /ENOENT/)
  fs.rmSync(root, { recursive: true })
})

test('pastas do Windows ficam em AppData e o runtime é node.exe', () => {
  const { desktopPaths, bundledNode } = require('../paths.cjs')
  const paths = desktopPaths(
    { APPDATA: 'C:\\Users\\J\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\J\\AppData\\Local' },
    'win32',
    'C:\\Users\\J',
  )
  assert.equal(paths.configDir, 'C:\\Users\\J\\AppData\\Roaming\\KOMA')
  assert.equal(paths.dataDir, 'C:\\Users\\J\\AppData\\Local\\KOMA\\library')
  assert.equal(paths.logDir, 'C:\\Users\\J\\AppData\\Local\\KOMA\\logs')
  assert.equal(desktopPaths({}, 'linux', '/home/j').dataDir, '/home/j/.local/share/koma/library')
  assert.match(bundledNode('/opt/koma', 'win32'), /runtime[\\/]node\.exe$/)
})
