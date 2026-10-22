import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

if (!process.argv.includes('--network') || !process.argv.includes('--database'))
  throw new Error('Informe --network --database CAMINHO. Usa cópia consistente; não altera a biblioteca original nem chama modelos.')
const input = process.argv[process.argv.indexOf('--database') + 1]
const bundle = (await fs.readFile('artifacts/latest-bundle.txt', 'utf8')).trim()
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { startBackend } = require(path.join(bundle, 'electron/resources/app/backend.cjs'))
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'koma-fontes-biblioteca-'))
const original = new Database(input, { readonly: true })
const before = original.prepare("SELECT work_id,id FROM work_chapters WHERE state='ready' ORDER BY id").all()
await original.backup(path.join(temp, 'local.sqlite'))
original.close()
const copy = new Database(path.join(temp, 'local.sqlite'))
copy.prepare('UPDATE works SET paused=1,sync_requested=1,sync_attempts=0,sync_retry_after=0').run()
copy.close()
const log = await fs.open(path.join(temp, 'backend.log'), 'a')
const backend = await startBackend({
  nodePath: path.join(bundle, 'runtime/node'),
  serverDir: path.join(bundle, 'server'),
  dataDir: temp,
  logFd: log.fd,
})
try {
  const session = await backend.bootstrap()
  const headers = { Cookie: `koma-session=${session.sessionToken}`, Origin: backend.url }
  const snapshot = async () => {
    const list = await (await fetch(backend.url + '/api/local/works', { headers })).json()
    const works = list.works || list
    return Promise.all(works.map(async (work) => (await fetch(`${backend.url}/api/local/works/${work.id}`, { headers })).json()))
  }
  const wait = async () => {
    const deadline = Date.now() + 180000
    while (Date.now() < deadline) {
      const details = await snapshot()
      if (details.every((detail) => !detail.work.syncRequested)) return details
      await delay(1000)
    }
    throw new Error('A atualização não concluiu no prazo da verificação. Consulte o log em ' + temp)
  }
  const details = await wait()
  const expected = { 1: 100, 2: 193, 3: 70 }
  for (const detail of details) {
    if (expected[detail.work.id]) assert.equal(detail.chapters.length, expected[detail.work.id], detail.work.title)
    for (const old of before.filter((c) => c.work_id === detail.work.id))
      assert.equal(detail.chapters.find((c) => c.id === old.id)?.state, 'ready', 'Capítulo pronto foi alterado')
    console.log(`${detail.work.title}: ${detail.chapters.length} catalogados, ${detail.work.readyChapters} prontos preservados`)
  }
  await fetch(backend.url + '/api/local/works/refresh', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: '{}',
  })
  const refreshed = await wait()
  for (const detail of refreshed)
    assert.deepEqual(
      detail.chapters.map((c) => c.id),
      details.find((d) => d.work.id === detail.work.id).chapters.map((c) => c.id),
      'Refresh duplicou capítulos',
    )
  const result = {
    checkedAt: new Date().toISOString(),
    databaseCopy: temp,
    modelCalls: 0,
    readyChaptersPreserved: before.length,
    refreshWithoutDuplicates: true,
    works: refreshed.map((d) => ({
      id: d.work.id,
      title: d.work.title,
      cataloged: d.chapters.length,
      ready: d.work.readyChapters,
      sources: d.sources,
    })),
  }
  const out = path.resolve('artifacts/fontes-reais-0.4.2/biblioteca-producao.json')
  await fs.mkdir(path.dirname(out), { recursive: true })
  await fs.writeFile(out, JSON.stringify(result, null, 2))
  console.log(out)
} finally {
  await backend.stop()
  await log.close()
}
