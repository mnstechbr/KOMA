import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'

const root = path.resolve(import.meta.dirname, '..')
const bundle = process.argv[2] || (await fs.readFile(path.join(root, 'artifacts/latest-bundle.txt'), 'utf8')).trim()
const require = createRequire(path.join(bundle, 'server/package.json'))
const sharp = require('sharp')
const { startBackend } = require(path.join(bundle, 'electron/resources/app/backend.cjs'))
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'koma-producao-'))
const dataDir = path.join(temp, 'biblioteca')
await fs.mkdir(dataDir)
const log = await fs.open(path.join(temp, 'backend.log'), 'a')
let backend
let cookie = ''
let checks = 0

async function request(route, { method = 'GET', body, origin, headers = {} } = {}) {
  return fetch(`${backend.url}${route}`, {
    method,
    body,
    headers: { Cookie: cookie, Origin: origin || backend.url, ...headers },
  })
}
async function json(route, method, data) {
  return request(route, { method, body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } })
}
function check(condition, message) {
  assert.ok(condition, message)
  checks++
  console.log(`OK: ${message}`)
}
async function start() {
  backend = await startBackend({
    nodePath: path.join(bundle, 'runtime/node'),
    serverDir: path.join(bundle, 'server'),
    dataDir,
    logFd: log.fd,
    automation: false,
  })
}

try {
  await start()
  const session = await backend.bootstrap()
  cookie = `koma-session=${session.sessionToken}`
  check(Boolean(session.userId), 'perfil local aberto sem cadastro')
  let response = await request('/')
  const html = await response.text()
  check(response.ok && response.url.endsWith('/inicio/secoes') && html.includes('KOMA'), 'abertura direta na biblioteca')
  const asset = html.match(/src="([^" ]+\.js[^" ]*)"/)?.[1]
  check(asset && (await request(asset)).ok, 'arquivos JavaScript presentes no pacote')
  check((await json('/api/local/bootstrap', 'POST', {})).status === 403, 'inicialização sem segredo bloqueada')
  check((await json('/api/setup/admin', 'POST', {})).status === 404, 'cadastro manual não existe no desktop')
  check((await request('/login')).status === 404, 'tela de login herdada não existe')
  check((await request('/api/sections', { headers: { Cookie: '' } })).status === 401, 'biblioteca exige autenticação')
  check((await request('/api/local/health', { origin: 'https://origem-invalida.example' })).status === 403, 'origem externa bloqueada')
  const invalidHostStatus = await new Promise((resolve, reject) => {
    http
      .get(`${backend.url}/api/local/health`, { headers: { host: 'origem-invalida.example' } }, (res) => {
        res.resume()
        res.once('end', () => resolve(res.statusCode))
      })
      .once('error', reject)
  })
  check(invalidHostStatus === 403, 'host externo bloqueado')
  check((await request('/api/public/sections/exemplo')).status === 404, 'compartilhamento público não existe')
  check(
    (await json('/api/translate/text-batch', 'POST', { texts: ['Teste que não deve sair da máquina'] })).status === 400,
    'tradução bloqueada enquanto o tradutor estiver desativado',
  )
  const translationDefaults = await (await request('/api/local/translation')).json()
  check(
    translationDefaults.desktop &&
      !translationDefaults.settings.enabled &&
      !translationDefaults.settings.consent.deepseek &&
      !translationDefaults.settings.consent.mimo,
    'cofre inicia desativado com autorizações próprias bloqueadas',
  )
  check((await request('/api/local/translation', { headers: { Cookie: '' } })).status === 401, 'configuração do cofre exige sessão local')
  check(
    (await json('/api/local/translation', 'PUT', { ...translationDefaults.settings, apiKey: 'synthetic-no-real-key' })).status === 400,
    'configuração rejeita campo de chave de API',
  )
  check(
    (
      await json('/api/local/translation', 'PUT', {
        ...translationDefaults.settings,
        enabled: true,
        translation: { provider: 'deepseek', model: 'model-config-only', credentialId: '' },
      })
    ).status === 403,
    'ativação exige autorização específica do provedor',
  )
  const dormantSettings = {
    ...translationDefaults.settings,
    translation: { provider: 'deepseek', model: 'model-config-only', credentialId: '' },
  }
  check((await json('/api/local/translation', 'PUT', dormantSettings)).ok, 'preferências sem segredo salvas sem chamada externa')
  check(
    (await json('/api/translate/text-batch', 'POST', { texts: ['Synthetic'], provider_lang: 'google' })).status === 400,
    'pedido não escolhe outro tradutor: segue desativado sem chamada externa',
  )
  check(
    (
      await request('/api/local/translation', {
        method: 'PUT',
        body: JSON.stringify(dormantSettings),
        origin: 'https://invalid.example',
        headers: { 'Content-Type': 'application/json' },
      })
    ).status === 403,
    'origem externa não altera autorizações do cofre',
  )
  check(
    (await request('/api/local/translation/check', { method: 'POST', origin: 'https://invalid.example' })).status === 403,
    'verificação da ponte rejeita origem externa',
  )

  const svg =
    '<svg width="800" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="300" fill="white"/><text x="80" y="150" font-family="sans-serif" font-size="48" fill="black">HELLO WORLD</text></svg>'
  const image = await sharp(Buffer.from(svg)).png().toBuffer()
  const form = new FormData()
  form.append('name', 'Capítulo sintético próprio')
  form.append('defer_processing', 'true')
  form.append('files', new Blob([image], { type: 'image/png' }), 'pagina.png')
  response = await request('/api/sections', { method: 'POST', body: form })
  const created = await response.json()
  const sectionId = created.section?.id
  check(response.ok && sectionId, 'importação de imagem própria sem envio externo')
  const list = await (await request('/api/sections')).json()
  check(list.meta.total === 1, 'biblioteca retorna dados persistidos')
  const detail = await (await request(`/api/sections/${sectionId}`)).json()
  const imageId = detail.section?.images?.[0]?.id || detail.images?.[0]?.id
  check(Boolean(imageId), 'capítulo contém a imagem importada')
  response = await request(`/api/sections/${sectionId}/images/${imageId}/original/view`)
  check(response.ok && Buffer.from(await response.arrayBuffer()).equals(image), 'arquivo original preservado byte a byte')
  const ocrForm = new FormData()
  ocrForm.append('file', new Blob([image], { type: 'image/png' }), 'pagina.png')
  response = await request('/api/ocr-image/queue', { method: 'POST', body: ocrForm })
  const ocr = await response.json()
  check(
    response.ok && ocr.job?.extracted_text?.includes('HELLO WORLD') && !ocr.job?.ocr_error,
    'OCR ONNX em CPU executado com bibliotecas incorporadas',
  )
  console.log(`OCR: ${ocr.job.elapsed_ms} ms`)
  response = await json(`/api/sections/${sectionId}/read-progress`, 'PUT', { done: true })
  check(response.ok, 'progresso de leitura salvo')
  check((await json(`/api/local/library/${sectionId}`, 'PATCH', { favorite: true, opened: true })).ok, 'favorito e última abertura salvos')
  const library = await (await request('/api/local/library')).json()
  check(
    library.items.length === 1 && library.items[0].favorite && library.items[0].read && library.lastOpenedId === sectionId,
    'biblioteca visual reflete favoritos e leitura reais',
  )
  check((await json('/api/local/library/999999', 'PATCH', { favorite: true })).status === 404, 'preferências rejeitam capítulo inexistente')
  // O consentimento por provedor fica nas preferências de tradução (verificado acima);
  // a autorização avulsa do modo antigo não existe mais.
  check((await request('/api/local/privacy')).status === 404, 'autorização avulsa do modo antigo removida')
  const firstUrl = backend.url
  await backend.stop()
  await assert.rejects(fetch(firstUrl))
  checks++
  console.log('OK: backend encerrado e porta liberada')
  await start()
  const secondSession = await backend.bootstrap()
  cookie = `koma-session=${secondSession.sessionToken}`
  check(secondSession.userId === session.userId, 'perfil preservado na segunda abertura automática')
  const restored = await (await request('/api/sections')).json()
  check(restored.meta.total === 1, 'biblioteca preservada na segunda inicialização')
  check((await (await request(`/api/sections/${sectionId}/read-progress`)).json()).done === true, 'progresso preservado após reiniciar')
  check(
    (await (await request('/api/local/translation')).json()).settings.enabled === false,
    'tradutor desativado continua desativado após reiniciar',
  )
  const persistedLibrary = await (await request('/api/local/library')).json()
  check(
    persistedLibrary.items[0].favorite && persistedLibrary.lastOpenedId === sectionId,
    'favorito e última leitura preservados ao reabrir',
  )
  const persistedTranslation = await (await request('/api/local/translation')).json()
  check(
    persistedTranslation.settings.translation.model === 'model-config-only' && !persistedTranslation.settings.enabled,
    'configuração sem chave e bloqueio preservados após reiniciar',
  )
  check((await request('/api/local/works', { headers: { Cookie: '' } })).status === 401, 'biblioteca de obras exige sessão pessoal')
  check(
    (
      await request('/api/local/works', {
        method: 'POST',
        origin: 'https://invalid.example',
        body: JSON.stringify({ sourceId: 'invalid' }),
        headers: { 'Content-Type': 'application/json' },
      })
    ).status === 403,
    'origem externa não adiciona obras',
  )
  check(
    (await json('/api/local/works', 'POST', { sourceId: '../../file' })).status === 400,
    'adicionar obra rejeita caminhos e identificadores inválidos',
  )
  const Database = require('better-sqlite3')
  const storage = new Database(path.join(dataDir, 'local.sqlite'))
  const sourceId = '00000000-0000-4000-8000-000000000001'
  const metadata = {
    source: 'mangadex',
    sourceId,
    title: 'Obra de teste própria',
    originalTitle: 'Original de teste',
    aliases: [{ language: 'en', title: 'Own test' }],
    description: 'Amostra própria.',
    descriptionLanguage: 'pt-br',
    originalLanguage: 'ja',
    authors: [],
    genres: [],
    year: 2026,
    coverFile: null,
  }
  storage.prepare('INSERT INTO catalog_cache VALUES(?,?,?)').run(sourceId, JSON.stringify(metadata), new Date().toISOString())
  response = await json('/api/local/works', 'POST', { sourceId })
  const workId = (await response.json()).id
  check(response.status === 201 && workId, 'obra adicionada uma vez pela API sem cadastro de capítulos')
  check((await (await json('/api/local/works', 'POST', { sourceId })).json()).id === workId, 'adicionar novamente não duplica a obra')
  const now = new Date().toISOString()
  const chapterId = Number(
    storage
      .prepare(
        `INSERT INTO work_chapters(work_id,chapter_key,source_id,title,number,language,position,page_count,section_id,state,created_at,updated_at) VALUES(?,'chapter:1',?,'Teste','1','en',1,1,?,'ready',?,?)`,
      )
      .run(workId, sourceId, sectionId, now, now).lastInsertRowid,
  )
  const pendingId = Number(
    storage
      .prepare(
        `INSERT INTO work_chapters(work_id,chapter_key,source_id,title,number,language,position,page_count,state,created_at,updated_at) VALUES(?,'chapter:2',?,'Na fila','2','en',2,1,'queued',?,?)`,
      )
      .run(workId, sourceId, now, now).lastInsertRowid,
  )
  storage
    .prepare(
      `INSERT INTO work_pages(chapter_id,page_index,source_file,image_id,state,ocr_json,width,height) VALUES(?,0,'synthetic.png',?,'ready','[]',800,300)`,
    )
    .run(chapterId, imageId)
  storage
    .prepare(
      `INSERT INTO section_image_ocr_items(section_image_id,det_id,x1,y1,x2,y2,ocr_text,translated_text,created_at) VALUES(?,1,60,70,600,220,'HELLO WORLD','Olá, mundo.',?)`,
    )
    .run(imageId, now)
  storage.prepare(`UPDATE works SET sync_requested=0,stage='queued' WHERE id=?`).run(workId)
  const workDetail = await (await request(`/api/local/works/${workId}`)).json()
  check(workDetail.chapters.length === 2 && workDetail.work.readyChapters === 1, 'obra agrupa todos os capítulos e mostra o andamento real')
  check(
    (await request(`/api/local/works/${workId}/chapters/${pendingId}`)).status === 409,
    'capítulo pendente não aparece como tradução pronta',
  )
  const readable = await (await request(`/api/local/works/${workId}/chapters/${chapterId}`)).json()
  check(
    readable.pages[0].items[0].text === 'Olá, mundo.' && readable.nextChapterId === null,
    'leitor recebe balões em PT-BR e não pula capítulos pendentes',
  )
  storage.prepare("UPDATE work_chapters SET state='partial' WHERE id=?").run(chapterId)
  storage.prepare("UPDATE work_pages SET state='review',message='Balão ilegível; original preservado.' WHERE chapter_id=?").run(chapterId)
  const partialReader = await (await request(`/api/local/works/${workId}/chapters/${chapterId}`)).json()
  check(
    partialReader.chapter?.state === 'partial' && partialReader.pages[0].note.includes('original preservado'),
    'capítulo parcial abre com aviso sem se declarar pronto',
  )
  const about = await (await request('/inicio/sobre')).text()
  check(
    about.includes('Jean Vitor') &&
      !about.includes('Marco Antonio') &&
      about.includes('jean-vitor-16a19642a') &&
      about.includes('translate-manga-br'),
    'tela Sobre apresenta o criador do KOMA, seu LinkedIn e o projeto de origem',
  )
  check((await json(`/api/local/works/${workId}/chapters/${chapterId}`, 'POST', {})).ok, 'progresso da leitura salvo no capítulo da obra')
  check(
    (await json(`/api/local/works/${workId}`, 'PATCH', { action: 'pause' })).ok &&
      (await (await request(`/api/local/works/${workId}`)).json()).work.paused,
    'preparação pode ser pausada pela API pessoal',
  )
  check(
    (await json(`/api/local/works/${workId}`, 'PATCH', { action: 'refresh' })).ok,
    'atualização individual agenda descoberta de novos capítulos',
  )
  check(
    (await (await json('/api/local/works/refresh', 'POST', {})).json()).updated === 1,
    'atualização global agenda todas as obras do usuário',
  )
  check(
    (await (await request('/api/local/library')).json()).items.length === 0,
    'capítulos da obra não viram cartões avulsos duplicados na biblioteca',
  )
  storage.close()
  await backend.stop()
  await start()
  const lastSession = await backend.bootstrap()
  cookie = `koma-session=${lastSession.sessionToken}`
  const afterRestart = await (await request(`/api/local/works/${workId}`)).json()
  check(
    afterRestart.chapters.length === 2 && afterRestart.chapters[0].read && afterRestart.work.paused,
    'obra, fila, capítulos e leitura preservados após reabrir',
  )
  await fs.writeFile(
    path.join(temp, 'resultados.json'),
    JSON.stringify({ checks, ocrMs: ocr.job.elapsed_ms, bundle, externalRequests: 0 }, null, 2),
  )
  console.log(`${checks} verificações passaram. Evidências: ${temp}`)
} finally {
  if (backend) await backend.stop()
  await log.close()
}
