import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

if (!process.argv.includes('--network')) {
  console.log('Use --network para consultar o catálogo público. Não utiliza LLM nem consome cota de IA.')
  process.exit(1)
}
const root = path.resolve(import.meta.dirname, '..')
const bundle = (await fs.readFile(path.join(root, 'artifacts/latest-bundle.txt'), 'utf8')).trim()
const require = createRequire(import.meta.url)
const { startBackend } = require(path.join(bundle, 'electron/resources/app/backend.cjs'))
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'koma-catalogo-real-'))
const log = await fs.open(path.join(temp, 'backend.log'), 'a')
let backend
let cookie
let checks = 0
const sourceId = '77bee52c-d2d6-44ad-a33a-1734c1fe696a'
const check = (value, label) => {
  assert.ok(value, label)
  checks++
  console.log(`OK: ${label}`)
}
async function start() {
  backend = await startBackend({
    nodePath: path.join(bundle, 'runtime/node'),
    serverDir: path.join(bundle, 'server'),
    dataDir: temp,
    logFd: log.fd,
  })
  const session = await backend.bootstrap()
  cookie = `koma-session=${session.sessionToken}`
}
async function request(route, method = 'GET', body) {
  return fetch(backend.url + route, {
    method,
    headers: { Cookie: cookie, Origin: backend.url, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}
async function detail(id) {
  return (await request(`/api/local/works/${id}`)).json()
}
async function waitFor(id, predicate) {
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    const value = await detail(id)
    if (predicate(value)) return value
    await delay(250)
  }
  throw new Error('A fonte não concluiu a descoberta dentro do tempo de teste.')
}
try {
  await start()
  let response = await request('/api/local/catalog?q=Eminence%20in%20Shadow')
  const result = await response.json()
  check(response.ok && result.results?.[0]?.sourceId === sourceId, 'busca real prioriza a obra principal sobre os derivados')
  const metadata = result.results[0]
  check(
    metadata.aliases.some((a) => a.language === 'ja') && metadata.description && metadata.coverFile,
    'metadados incluem título japonês, aliases, sinopse e capa',
  )
  response = await request(`/api/local/catalog/${sourceId}/cover`)
  check(response.ok && response.headers.get('content-type') === 'image/jpeg', 'capa obtida pela fonte e armazenada localmente')
  response = await request('/api/local/works', 'POST', { sourceId })
  const { id } = await response.json()
  check(response.status === 201 && id, 'adicionar obra cria a biblioteca sem cadastrar capítulos')
  const found = await waitFor(id, (value) => value.chapters?.length > 0 && !value.work.syncRequested)
  check(found.chapters.length > 1, 'worker descobre e cadastra automaticamente os capítulos reais da fonte')
  await request(`/api/local/works/${id}`, 'PATCH', { action: 'pause' })
  check((await detail(id)).work.paused, 'preparação pausada antes de usar modelos ou baixar a coleção')
  const ids = found.chapters.map((c) => c.id)
  await request(`/api/local/works/${id}`, 'PATCH', { action: 'refresh' })
  const refreshed = await waitFor(id, (value) => !value.work.syncRequested)
  check(
    JSON.stringify(refreshed.chapters.map((c) => c.id)) === JSON.stringify(ids),
    'refresh individual consulta a fonte sem duplicar os capítulos',
  )
  response = await request('/api/local/works/refresh', 'POST', {})
  check((await response.json()).updated === 1, 'refresh global agenda a atualização da obra')
  await waitFor(id, (value) => !value.work.syncRequested)
  await backend.stop()
  await start()
  const reopened = await detail(id)
  check(reopened.work.paused && reopened.chapters.length === ids.length, 'obra, capítulos e pausa persistem após reiniciar o aplicativo')
  check(
    (await (await request('/api/local/translation')).json()).settings.enabled === false,
    'teste não habilita tradução nem usa chaves do cofre',
  )
  const evidence = {
    checks,
    source: 'MangaDex',
    query: 'Eminence in Shadow',
    sourceId,
    title: metadata.title,
    chapters: reopened.chapters.length,
    languages: [...new Set(reopened.chapters.map((c) => c.language))],
    modelCalls: 0,
    temporaryData: temp,
  }
  await fs.writeFile(path.join(temp, 'resultados.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  if (backend) await backend.stop()
  await log.close()
}
