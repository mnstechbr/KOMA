// Exercita downloads reais em cópia consistente da biblioteca; tradução desativada.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const bundle = (await fs.readFile('artifacts/latest-bundle.txt', 'utf8')).trim()
const root = path.resolve('artifacts/recuperacao-0.4.3')
const dataDir = path.join(root, `copia-${Date.now()}`)
await fs.mkdir(dataDir, { recursive: true })
const input = new Database(path.join(root, 'baseline.sqlite'), { readonly: true })
await input.backup(path.join(dataDir, 'local.sqlite'))
input.close()
const copy = new Database(path.join(dataDir, 'local.sqlite'))
const targets = []
for (const { id } of copy.prepare('SELECT id FROM works').all()) {
  const chapter = copy
    .prepare(
      `SELECT c.id,c.work_id,c.number,c.language,c.page_count,SUM(p.image_id IS NULL) AS missing
    FROM work_chapters c JOIN work_pages p ON p.chapter_id=c.id
    WHERE c.work_id=? AND c.state NOT IN ('ready','partial','error') AND c.language='en'
    GROUP BY c.id HAVING missing>0 ORDER BY missing,c.id LIMIT 1`,
    )
    .get(id)
  assert.ok(chapter, `Capítulo incompleto da obra ${id}`)
  targets.push(chapter)
}
const ready = copy.prepare("SELECT id,section_id,read_done FROM work_chapters WHERE state='ready'").all()
const saved = copy.prepare('SELECT value FROM kv_store WHERE key=?').get('koma:translation:kpassword:v1')
const settings = JSON.parse(saved.value)
settings.enabled = false
copy.prepare('UPDATE kv_store SET value=? WHERE key=?').run(JSON.stringify(settings), 'koma:translation:kpassword:v1')
copy.prepare('DELETE FROM automation_lock').run()
copy.prepare('UPDATE works SET paused=0,sync_requested=0').run()
// Isolar a amostra sem baixar a biblioteca inteira duas vezes. Só nesta cópia.
copy.prepare("UPDATE work_chapters SET state='error' WHERE state<>'ready'").run()
for (const target of targets) copy.prepare("UPDATE work_chapters SET state='queued',retry_after=0 WHERE id=?").run(target.id)
copy.close()
const { startBackend } = require(path.join(bundle, 'electron/resources/app/backend.cjs'))
const log = await fs.open(path.join(dataDir, 'backend.log'), 'a')
const backend = await startBackend({
  nodePath: path.join(bundle, 'runtime/node'),
  serverDir: path.join(bundle, 'server'),
  dataDir,
  logFd: log.fd,
})
try {
  const session = await backend.bootstrap()
  const headers = { Cookie: `koma-session=${session.sessionToken}`, Origin: backend.url }
  const get = (route) => fetch(backend.url + route, { headers })
  const snapshots = []
  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    const details = await Promise.all(targets.map(async (target) => (await get(`/api/local/works/${target.work_id}`)).json()))
    const state = targets.map((target, index) => ({ ...target, ...details[index].chapters.find((chapter) => chapter.id === target.id) }))
    console.log(JSON.stringify(state.map((chapter) => ({ work: chapter.work_id, chapter: chapter.number, state: chapter.state }))))
    snapshots.push(state)
    const observed = new Database(path.join(dataDir, 'local.sqlite'), { readonly: true })
    const done = targets.every((target) => {
      const row = observed
        .prepare('SELECT COUNT(*) AS n,SUM(image_id IS NOT NULL) AS downloaded FROM work_pages WHERE chapter_id=?')
        .get(target.id)
      return row.n > 0 && row.n === row.downloaded
    })
    observed.close()
    if (done) break
    await delay(5000)
  }
  const observed = new Database(path.join(dataDir, 'local.sqlite'), { readonly: true })
  const checked = []
  for (const target of targets) {
    const images = observed
      .prepare('SELECT p.image_id,i.original_path FROM work_pages p LEFT JOIN section_images i ON i.id=p.image_id WHERE p.chapter_id=?')
      .all(target.id)
    assert.equal(images.length, target.page_count)
    for (const image of images) {
      assert.ok(image.image_id)
      await fs.access(image.original_path)
    }
    const detail = await (await get(`/api/local/works/${target.work_id}`)).json()
    assert.notEqual(
      detail.chapters.find((chapter) => chapter.id === target.id).state,
      'ready',
      'Original não pode se declarar tradução pronta',
    )
    checked.push({ workId: target.work_id, chapter: target.number, pages: images.length, newPages: target.missing })
  }
  for (const old of ready)
    assert.deepEqual(observed.prepare("SELECT id,section_id,read_done FROM work_chapters WHERE id=? AND state='ready'").get(old.id), old)
  assert.equal(observed.prepare('SELECT COUNT(*) AS n FROM translation_checkpoints').get().n, 0)
  observed.close()
  const search = await (await get('/api/local/catalog?q=Eminence%20in%20Shadow')).json()
  assert.ok(search.sources.some((source) => source.name === 'MangaDex' && source.available))
  const result = {
    checkedAt: new Date().toISOString(),
    bundle,
    dataDir,
    modelCalls: 0,
    previouslyReadyPreserved: ready.length,
    chapters: checked,
    searchSources: search.sources,
    searchResults: search.results.length,
  }
  await fs.writeFile(path.join(root, 'recuperacao-verificada.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await backend.stop()
  await log.close()
}
