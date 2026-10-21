import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { buildZip, readZip, writeZipFile, type ZipInput } from '@/lib/server/cbz'
import { getStorageSettings, type StorageSettings } from './settings'
import { komaRemoteReady, remoteRoot, runRclone, type RcloneResult } from './rclone'

// Biblioteca na nuvem: cada capítulo pronto vira um .cbz com as páginas em
// PT-BR na raiz (abre em qualquer leitor de quadrinhos), os originais dentro de
// "originais.zip" e o mapa "koma.json" para devolver cada arquivo ao lugar.
// O banco continua no computador; só as imagens vão para a nuvem.

export type Runner = (settings: StorageSettings, args: string[]) => Promise<RcloneResult>
interface ChapterInfo { id: number; number: string | null; title: string; language: string; section_id: number; work_title: string }
interface Manifest { format: 'koma-cbz/1'; work: string; chapter: string | null; title: string; language: string; pages: Array<{ name: string; file: string }>; files: string[] }

const MANIFEST = 'koma.json'
const ORIGINALS = 'originais.zip'
const safe = (value: string) => value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'sem título'

function chapterInfo(database: Database.Database, chapterId: number) {
  return database.prepare(`SELECT c.id,c.number,c.title,c.language,c.section_id,w.title AS work_title FROM work_chapters c JOIN works w ON w.id=c.work_id WHERE c.id=? AND c.section_id IS NOT NULL`).get(chapterId) as ChapterInfo | undefined
}

/** Pasta das páginas do capítulo (sections/<id>), deduzida das imagens registradas. */
export function sectionDirectory(database: Database.Database, sectionId: number) {
  const image = database.prepare('SELECT original_path FROM section_images WHERE section_id=? ORDER BY order_index LIMIT 1').get(sectionId) as { original_path: string } | undefined
  return image ? path.dirname(path.dirname(image.original_path)) : null
}

function listFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full))
    else if (entry.isFile() && !entry.name.endsWith('.partial')) out.push(full)
  }
  return out
}

/** Muda quando alguma página é refeita: a cópia na nuvem precisa ser atualizada. */
export function localSignature(directory: string) {
  const files = listFiles(directory).map((file) => [path.relative(directory, file), fs.statSync(file).size] as const).sort(([a], [b]) => a.localeCompare(b))
  return { signature: crypto.createHash('sha1').update(JSON.stringify(files)).digest('hex'), bytes: files.reduce((sum, [, size]) => sum + size, 0), count: files.length }
}

export function remoteChapterPath(settings: StorageSettings, chapter: Pick<ChapterInfo, 'number' | 'title' | 'work_title' | 'id'>) {
  const number = chapter.number ? `Capítulo ${chapter.number.padStart(4, '0')}` : `Capítulo #${chapter.id}`
  const title = chapter.title && chapter.title !== chapter.number ? ` - ${safe(chapter.title)}` : ''
  return `${remoteRoot(settings)}/${safe(chapter.work_title)}/${safe(number + title)}.cbz`
}

export function packChapter(database: Database.Database, chapterId: number) {
  const chapter = chapterInfo(database, chapterId)
  if (!chapter) throw new Error('Capítulo sem páginas locais.')
  const directory = sectionDirectory(database, chapter.section_id)
  if (!directory) throw new Error('Capítulo sem páginas locais.')
  const images = database.prepare('SELECT original_path, translated_path FROM section_images WHERE section_id=? ORDER BY order_index').all(chapter.section_id) as Array<{ original_path: string; translated_path: string | null }>
  const pages: Manifest['pages'] = []
  const root: ZipInput[] = []
  const used = new Set<string>()
  images.forEach((image, index) => {
    const source = image.translated_path && fs.existsSync(image.translated_path) ? image.translated_path : image.original_path
    if (!fs.existsSync(source)) throw new Error('Há páginas faltando neste capítulo.')
    const name = `${String(index + 1).padStart(4, '0')}${path.extname(source).toLowerCase() || '.jpg'}`
    pages.push({ name, file: path.relative(directory, source) })
    root.push({ name, data: fs.readFileSync(source) })
    used.add(path.resolve(source))
  })
  const rest = listFiles(directory).filter((file) => !used.has(path.resolve(file)))
  const files = rest.map((file) => path.relative(directory, file))
  const manifest: Manifest = { format: 'koma-cbz/1', work: chapter.work_title, chapter: chapter.number, title: chapter.title, language: chapter.language, pages, files }
  const entries: ZipInput[] = [...root, { name: ORIGINALS, data: buildZip(rest.map((file, i) => ({ name: files[i], data: fs.readFileSync(file) }))) }, { name: MANIFEST, data: Buffer.from(JSON.stringify(manifest, null, 2)) }]
  return { chapter, directory, entries, ...localSignature(directory) }
}

function insideDirectory(directory: string, relative: string) {
  const target = path.resolve(directory, relative)
  if (!target.startsWith(path.resolve(directory) + path.sep)) throw new Error('Arquivo de capítulo com caminho inválido.')
  return target
}

/** Devolve as páginas de um .cbz do KOMA para a pasta do capítulo. */
export function unpackChapter(buffer: Buffer, directory: string) {
  const entries = new Map(readZip(buffer).map((entry) => [entry.name, entry.data]))
  const manifest = JSON.parse(entries.get(MANIFEST)?.toString('utf8') || 'null') as Manifest | null
  if (manifest?.format !== 'koma-cbz/1') throw new Error('Este arquivo não foi criado pelo KOMA.')
  const write = (relative: string, data: Buffer) => {
    const target = insideDirectory(directory, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(`${target}.partial`, data)
    fs.renameSync(`${target}.partial`, target)
  }
  for (const page of manifest.pages) { const data = entries.get(page.name); if (!data) throw new Error('Página ausente no arquivo do capítulo.'); write(page.file, data) }
  const originals = new Map(readZip(entries.get(ORIGINALS) || buildZip([])).map((entry) => [entry.name, entry.data]))
  for (const file of manifest.files) { const data = originals.get(file); if (!data) throw new Error('Original ausente no arquivo do capítulo.'); write(file, data) }
}

const tempDir = () => { const dir = path.join(os.tmpdir(), 'koma-cloud'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir }

async function remoteSize(settings: StorageSettings, run: Runner, remote: string) {
  const result = await run(settings, ['lsjson', remote])
  if (!result.ok) return null
  try { return (JSON.parse(result.stdout) as Array<{ Size: number }>)[0]?.Size ?? null } catch { return null }
}

export async function uploadChapter(database: Database.Database, settings: StorageSettings, chapterId: number, run: Runner) {
  const packed = packChapter(database, chapterId)
  const remote = remoteChapterPath(settings, packed.chapter)
  const file = path.join(tempDir(), `${chapterId}-${Date.now()}.cbz`)
  try {
    writeZipFile(file, packed.entries)
    const size = fs.statSync(file).size
    const result = await run(settings, ['copyto', file, remote])
    if (!result.ok) throw new Error(cloudError(result))
    // Só conta como guardado depois de conferir o tamanho na nuvem.
    if (await remoteSize(settings, run, remote) !== size) throw new Error('A nuvem não confirmou o envio do capítulo.')
    database.prepare(`INSERT INTO work_chapter_cloud (chapter_id,remote_path,signature,size_bytes,local_bytes,uploaded_at,evicted) VALUES (?,?,?,?,?,?,0)
      ON CONFLICT(chapter_id) DO UPDATE SET remote_path=excluded.remote_path,signature=excluded.signature,size_bytes=excluded.size_bytes,local_bytes=excluded.local_bytes,uploaded_at=excluded.uploaded_at,evicted=0`)
      .run(chapterId, remote, packed.signature, size, packed.bytes, new Date().toISOString())
    return { remote, size }
  } finally { fs.rmSync(file, { force: true }) }
}

function cloudError(result: RcloneResult) {
  if (result.missing) return 'O rclone não está instalado neste computador.'
  const text = result.stderr || result.stdout
  if (/didn't find section in config file|not found in config/i.test(text)) return 'A conta da nuvem não está conectada.'
  if (/quota|storageQuotaExceeded|insufficient/i.test(text)) return 'Sem espaço na nuvem.'
  if (/token|unauthori[sz]ed|invalid_grant|401/i.test(text)) return 'O login da nuvem expirou. Conecte a conta de novo.'
  if (/no such host|timeout|connection/i.test(text)) return 'Sem conexão com a nuvem.'
  return 'A nuvem recusou o envio do capítulo.'
}

const restoring = new Map<number, Promise<void>>()

/** Garante as páginas no computador antes de abrir o capítulo. */
export function ensureChapterLocal(database: Database.Database, chapterId: number, run: Runner = runRclone) {
  const row = database.prepare('SELECT remote_path, evicted FROM work_chapter_cloud WHERE chapter_id=?').get(chapterId) as { remote_path: string; evicted: number } | undefined
  if (!row?.evicted) return Promise.resolve()
  const pending = restoring.get(chapterId)
  if (pending) return pending
  const task = (async () => {
    const chapter = chapterInfo(database, chapterId)
    const directory = chapter && sectionDirectory(database, chapter.section_id)
    if (!chapter || !directory) throw new Error('Capítulo não encontrado.')
    const settings = getStorageSettings(database)
    const file = path.join(tempDir(), `${chapterId}-restore-${Date.now()}.cbz`)
    try {
      const result = await run(settings, ['copyto', row.remote_path, file])
      if (!result.ok) throw new Error(cloudError(result))
      unpackChapter(fs.readFileSync(file), directory)
      database.prepare('UPDATE work_chapter_cloud SET evicted=0 WHERE chapter_id=?').run(chapterId)
    } finally { fs.rmSync(file, { force: true }) }
  })().finally(() => restoring.delete(chapterId))
  restoring.set(chapterId, task)
  return task
}

/** Capítulos prontos cuja cópia na nuvem falta ou ficou desatualizada. */
export function chaptersToUpload(database: Database.Database, limit = 1, recheckUploaded = true) {
  const rows = database.prepare(`SELECT c.id, c.section_id, k.signature, k.evicted FROM work_chapters c LEFT JOIN work_chapter_cloud k ON k.chapter_id=c.id
    WHERE c.state='ready' AND c.section_id IS NOT NULL AND COALESCE(k.evicted,0)=0
    AND NOT EXISTS(SELECT 1 FROM work_pages p WHERE p.chapter_id=c.id AND (p.upgrade_pending=1 OR p.state NOT IN ('ready','review')))
    ORDER BY c.work_id, c.position`).all() as Array<{ id: number; section_id: number; signature: string | null }>
  const out: number[] = []
  for (const row of rows) {
    // Conferir capítulos já enviados lê todos os arquivos: só de tempos em tempos.
    if (row.signature && !recheckUploaded) continue
    const directory = sectionDirectory(database, row.section_id)
    if (!directory) continue
    if (row.signature !== localSignature(directory).signature) out.push(row.id)
    if (out.length >= limit) break
  }
  return out
}

/** Modo "só na nuvem": libera espaço apagando páginas já conferidas na nuvem. */
export function evictChapters(database: Database.Database, settings: StorageSettings) {
  if (settings.mode !== 'cloud' || settings.provider === 'local') return 0
  const rows = database.prepare(`SELECT c.id, c.section_id, c.work_id, c.read_done, k.signature, w.last_opened_at FROM work_chapter_cloud k
    JOIN work_chapters c ON c.id=k.chapter_id JOIN works w ON w.id=c.work_id
    WHERE k.evicted=0 AND c.state='ready' ORDER BY c.read_done DESC, COALESCE(w.last_opened_at,'') ASC, c.position DESC`).all() as Array<{ id: number; section_id: number; work_id: number; read_done: number; signature: string }>
  // Os próximos três capítulos não lidos de cada obra ficam sempre no computador.
  const keep = new Set<number>()
  for (const work of database.prepare('SELECT DISTINCT work_id FROM work_chapters').all() as Array<{ work_id: number }>) {
    for (const row of database.prepare(`SELECT id FROM work_chapters WHERE work_id=? AND read_done=0 AND state IN ('ready','partial') ORDER BY position LIMIT 3`).all(work.work_id) as Array<{ id: number }>) keep.add(row.id)
  }
  const limit = settings.cacheGb * 1024 ** 3
  const sizes = rows.map((row) => { const directory = sectionDirectory(database, row.section_id); return { row, directory, local: directory ? localSignature(directory) : null } })
  let total = sizes.reduce((sum, item) => sum + (item.local?.bytes || 0), 0)
  let evicted = 0
  for (const { row, directory, local } of sizes) {
    if (total <= limit) break
    if (keep.has(row.id) || !directory || !local || local.signature !== row.signature) continue
    for (const file of listFiles(directory)) fs.rmSync(file, { force: true })
    database.prepare('UPDATE work_chapter_cloud SET evicted=1, local_bytes=? WHERE chapter_id=?').run(local.bytes, row.id)
    total -= local.bytes
    evicted++
  }
  return evicted
}

export interface CloudStatus { uploaded: number; pending: number; evicted: number; ready: number; uploading: number | null; lastError: string; lastSyncAt: string | null }
const state: { uploading: number | null; lastError: string; lastSyncAt: string | null; retryAt: number; timer: NodeJS.Timeout | null; lastFullScan: number } = { uploading: null, lastError: '', lastSyncAt: null, retryAt: 0, timer: null, lastFullScan: 0 }

export function cloudStatus(database: Database.Database): CloudStatus {
  const counts = database.prepare(`SELECT
      (SELECT COUNT(*) FROM work_chapters WHERE state='ready' AND section_id IS NOT NULL) AS ready,
      (SELECT COUNT(*) FROM work_chapter_cloud k JOIN work_chapters c ON c.id=k.chapter_id) AS uploaded,
      (SELECT COUNT(*) FROM work_chapter_cloud k JOIN work_chapters c ON c.id=k.chapter_id WHERE k.evicted=1) AS evicted`).get() as { ready: number; uploaded: number; evicted: number }
  return { ...counts, pending: Math.max(0, counts.ready - counts.uploaded), uploading: state.uploading, lastError: state.lastError, lastSyncAt: state.lastSyncAt }
}

export async function syncOnce(database: Database.Database, run: Runner = runRclone) {
  const settings = getStorageSettings(database)
  if (settings.provider === 'local' || state.uploading !== null || Date.now() < state.retryAt) return
  if ((settings.provider === 'gdrive' || settings.provider === 'onedrive') && !komaRemoteReady(settings.provider)) { state.lastError = 'A conta da nuvem não está conectada. Conecte de novo em Preferências.'; return }
  const full = Date.now() - state.lastFullScan > 10 * 60000
  if (full) state.lastFullScan = Date.now()
  for (const chapterId of chaptersToUpload(database, 3, full)) {
    state.uploading = chapterId
    try {
      await uploadChapter(database, settings, chapterId, run)
      state.lastError = ''
      state.lastSyncAt = new Date().toISOString()
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : 'Falha ao enviar para a nuvem.'
      state.retryAt = Date.now() + 5 * 60000
      console.error('[KOMA] Falha ao enviar capítulo para a nuvem', { chapterId })
      break
    } finally { state.uploading = null }
  }
  evictChapters(database, settings)
}

export function retryCloudNow() { state.retryAt = 0 }

export function startCloudSync(database: Database.Database) {
  if (state.timer) return
  const tick = () => { void syncOnce(database).catch(() => undefined).finally(() => { state.timer = setTimeout(tick, 30000); state.timer.unref() }) }
  state.timer = setTimeout(tick, 15000); state.timer.unref()
}
