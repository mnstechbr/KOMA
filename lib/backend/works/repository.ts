import type Database from 'better-sqlite3'
import { db } from '../shared/database.module'
import type { CatalogWork, SourceChapter, WorkSummary, WorkChapter } from '@/lib/works'
import {identifySource} from './source-registry'
import { versionRank } from './aggregators'
import { getLanguageSettings } from '../shared/language-settings'
import { localizeMetadata } from './synopsis'
import { pendingRenderPages } from './render'
import { SourceError } from './source-http'
import { customWorkUrl } from './catalog'
import { SAME_LANGUAGE_SQL } from '@/lib/languages'

// Fontes diferentes tentadas para o mesmo capítulo antes de marcar erro.
const MAX_VERSION_ATTEMPTS = 6
// "Já está lendo?": do capítulo em que a pessoa parou em diante primeiro; depois o começo.
const READING_ORDER = 'CASE WHEN w.start_number IS NOT NULL AND (c.number IS NULL OR CAST(c.number AS REAL) < w.start_number) THEN 1 ELSE 0 END'

export interface WorkRow { id: number; user_id: number; source: string; source_id: string; title: string; metadata_json: string; target_language: string; paused: number; sync_requested: number; sync_attempts: number; stage: string; message: string }
export interface ChapterRow { id: number; work_id: number; source_id: string; title: string; number: string | null; language: string; section_id: number | null; page_count: number; attempts: number; state: string }
export interface PageRow { id: number; chapter_id: number; page_index: number; source_file: string; image_id: number | null; state: string; ocr_json: string | null; message: string | null; recovery_attempted: number; width: number | null; height: number | null }
const now = () => new Date().toISOString()

export class WorksRepository {
  constructor(public readonly database: Database.Database = db) {}
  cache(work: CatalogWork) {
    this.database.prepare(`INSERT INTO catalog_cache VALUES (?, ?, ?) ON CONFLICT(source_id) DO UPDATE SET metadata_json=excluded.metadata_json, updated_at=excluded.updated_at`).run(work.sourceId, JSON.stringify(work), now())
  }
  cached(id: string): CatalogWork | null {
    const row = this.database.prepare('SELECT metadata_json FROM catalog_cache WHERE source_id=?').get(id) as { metadata_json: string } | undefined
    return row ? JSON.parse(row.metadata_json) : null
  }
  /** "choice": capítulos escolhidos ao adicionar (chave ou número); vazio = todos. */
  /** "startNumber": capítulo em que a pessoa parou de ler (os anteriores ficam lidos). */
  add(userId: number, metadata: CatalogWork, choice: Array<{ key: string; number: string | null }> = [], startNumber: number | null = null): number {
    return this.database.transaction(() => {
      this.cache(metadata)
      // Obra de fonte personalizada já vinculada a outra obra da biblioteca: a mesma obra.
      const custom = metadata.source === 'mangadex' ? null : customWorkUrl(metadata.sourceId)
      if (custom) {
        const existing = this.database.prepare('SELECT w.id FROM works w JOIN work_catalog_sources s ON s.work_id=w.id WHERE w.user_id=? AND s.url=?').get(userId,custom.url) as {id:number} | undefined
        if (existing) return existing.id
      }
      this.database.prepare(`INSERT OR IGNORE INTO works(user_id,source,source_id,title,metadata_json,target_language,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(userId, metadata.source, metadata.sourceId, metadata.title, JSON.stringify(metadata), getLanguageSettings(this.database).target, now(), now())
      const id = (this.database.prepare('SELECT id FROM works WHERE user_id=? AND source=? AND source_id=?').get(userId, metadata.source, metadata.sourceId) as { id: number }).id
      if (choice.length && !(this.database.prepare('SELECT 1 FROM work_chapters WHERE work_id=? LIMIT 1').get(id))) this.database.prepare('UPDATE works SET chapter_choice=? WHERE id=?').run(JSON.stringify(choice), id)
      if (startNumber !== null && Number.isFinite(startNumber) && !(this.database.prepare('SELECT 1 FROM work_chapters WHERE work_id=? LIMIT 1').get(id))) this.database.prepare('UPDATE works SET start_number=? WHERE id=?').run(startNumber, id)
      if (custom) this.database.prepare('INSERT OR IGNORE INTO work_catalog_sources(work_id,provider,url) VALUES(?,?,?)').run(id,custom.provider,custom.url)
      return id
    })()
  }
  row(id: number, userId?: number) {
    return this.database.prepare(`SELECT * FROM works WHERE id=? ${userId === undefined ? '' : 'AND user_id=?'}`).get(...(userId === undefined ? [id] : [id, userId])) as WorkRow | undefined
  }
  list(userId: number): WorkSummary[] {
    const rows = this.database.prepare(`SELECT w.*, COUNT(c.id) AS total_chapters,
      COALESCE(SUM(c.state IN ('ready','partial')),0) AS ready_chapters, COALESCE(SUM(c.read_done),0) AS read_chapters,
      COALESCE(SUM(c.state IN ('ready','partial') AND c.read_done=0 AND c.position > (SELECT COALESCE(MAX(r.position),-1) FROM work_chapters r WHERE r.work_id=w.id AND r.read_done=1)),0) AS unread_ready,
      COALESCE(SUM(c.page_count),0) AS total_pages,
      (SELECT COUNT(*) FROM work_pages p JOIN work_chapters cp ON cp.id=p.chapter_id WHERE cp.work_id=w.id AND p.state='ready') AS prepared_pages,
      (SELECT COUNT(*) FROM work_pages p JOIN work_chapters cp ON cp.id=p.chapter_id WHERE cp.work_id=w.id AND p.image_id IS NOT NULL) AS downloaded_pages,
      (SELECT COUNT(*) FROM work_chapters cp WHERE cp.work_id=w.id AND cp.page_count>0 AND (SELECT COUNT(*) FROM work_pages p WHERE p.chapter_id=cp.id AND p.image_id IS NOT NULL)=cp.page_count) AS downloaded_chapters,
      (SELECT COUNT(*) FROM work_pages p JOIN work_chapters cp ON cp.id=p.chapter_id WHERE cp.work_id=w.id AND (p.upgrade_pending=1 OR p.render_stale=1)) AS revision_pending
      FROM works w LEFT JOIN work_chapters c ON c.work_id=w.id WHERE w.user_id=? GROUP BY w.id ORDER BY COALESCE(w.last_opened_at,w.created_at) DESC,w.id DESC`).all(userId) as Array<WorkRow & { favorite: number; last_synced_at: string | null; total_chapters: number; ready_chapters: number; read_chapters: number; total_pages: number; prepared_pages: number; downloaded_pages: number; downloaded_chapters: number; unread_ready: number; last_opened_at: string | null; revision_pending: number }>
    const next = this.database.prepare(`SELECT id,number,title FROM work_chapters WHERE work_id=? AND read_done=0 AND state IN ('ready','partial')
      ORDER BY CASE WHEN position > COALESCE((SELECT MAX(position) FROM work_chapters WHERE work_id=? AND read_done=1),-1) THEN 0 ELSE 1 END, position, id LIMIT 1`)
    const ui = getLanguageSettings(this.database).ui
    return rows.map((row) => {
      const metadata = localizeMetadata(JSON.parse(row.metadata_json) as CatalogWork, ui)
      const image = this.database.prepare(`SELECT i.id,c.section_id FROM work_chapters c JOIN section_images i ON i.section_id=c.section_id WHERE c.work_id=? ORDER BY c.position,i.order_index LIMIT 1`).get(row.id) as { id: number; section_id: number } | undefined
      return { id: row.id, title: row.title, sourceId: row.source_id, metadata, favorite: Boolean(row.favorite), paused: Boolean(row.paused), stage: row.paused ? 'paused' : row.stage, message: row.message, syncRequested: Boolean(row.sync_requested), lastSyncedAt: row.last_synced_at, totalChapters: row.total_chapters, readyChapters: row.ready_chapters, readChapters: row.read_chapters, totalPages: row.total_pages, preparedPages: row.prepared_pages, downloadedPages: row.downloaded_pages, downloadedChapters: row.downloaded_chapters, lastOpenedAt: row.last_opened_at, unreadReady: row.unread_ready, nextChapter: (next.get(row.id, row.id) as WorkSummary['nextChapter'] | undefined) ?? null, translationWait: row.ready_chapters < row.total_chapters ? this.cooldown() : null, targetLanguage: row.target_language || 'pt-br', revisionPending: row.revision_pending, coverUrl: metadata.coverFile ? `/api/local/catalog/${row.source_id}/cover` : image ? `/api/sections/${image.section_id}/images/${image.id}/original/view` : null }
    })
  }
  detail(id: number, userId: number) {
    const work = this.list(userId).find((work) => work.id === id)
    if (!work) return null
    const rows = this.database.prepare(`SELECT c.*, (SELECT COUNT(*) FROM work_pages p WHERE p.chapter_id=c.id AND p.state='ready') AS ready_pages FROM work_chapters c WHERE c.work_id=? ORDER BY c.position,c.id`).all(id) as Array<ChapterRow & { chapter_key: string; volume: string | null; position: number; message: string; ready_pages: number; read_done: number; created_at: string }>
    const chapters: WorkChapter[] = rows.map((c) => ({ id: c.id, key: c.chapter_key, sourceId: c.source_id, title: c.title, number: c.number, volume: c.volume, position: c.position, language: c.language, pageCount: c.page_count, state: c.state, message: c.message, sectionId: c.section_id, readyPages: c.ready_pages, read: Boolean(c.read_done), createdAt: c.created_at }))
    const sources = this.database.prepare(`SELECT kind,url,status,message,checked_at AS checkedAt FROM work_source_checks WHERE work_id=? ORDER BY CASE kind WHEN 'original' THEN 0 ELSE 1 END`).all(id)
    return { work, chapters, sources }
  }
  bindSource(id: number, userId: number, value: string) {
    if (!this.row(id,userId)) return false
    const {provider,url} = identifySource(value)
    this.database.transaction(()=>{
      this.database.prepare('INSERT OR IGNORE INTO work_catalog_sources(work_id,provider,url) VALUES(?,?,?)').run(id,provider,url)
      this.database.prepare('UPDATE works SET sync_requested=1,sync_attempts=0,sync_retry_after=0 WHERE id=?').run(id)
    })()
    return true
  }
  control(id: number, userId: number, action: 'refresh' | 'pause' | 'resume' | 'favorite', favorite?: boolean) {
    if (!this.row(id, userId)) return false
    if (action === 'refresh') this.database.transaction(() => {
      this.database.prepare(`UPDATE works SET sync_requested=1,sync_attempts=0,sync_retry_after=0,updated_at=? WHERE id=?`).run(now(), id)
      this.database.prepare(`UPDATE work_chapters SET state='queued',retry_after=0,attempts=0,version_attempts=0 WHERE work_id=? AND state IN ('error','partial')`).run(id)
      this.database.prepare(`UPDATE work_pages SET state=CASE WHEN ocr_json IS NULL THEN 'ocr' ELSE 'translation' END,recovery_attempted=0 WHERE chapter_id IN (SELECT id FROM work_chapters WHERE work_id=?) AND state='review'`).run(id)
    })()
    if (action === 'pause') this.database.prepare(`UPDATE works SET paused=1,updated_at=? WHERE id=?`).run(now(), id)
    if (action === 'resume') this.database.transaction(() => {
      this.database.prepare("DELETE FROM translation_cooldown WHERE code IN ('user_denied','permission_revoked','provider_http_error','unsupported_operation')").run()
      this.database.prepare(`UPDATE works SET paused=0,stage='queued',message='',updated_at=? WHERE id=?`).run(now(), id)
      this.database.prepare(`UPDATE work_chapters SET state='queued',attempts=0,version_attempts=0,retry_after=0,message='' WHERE work_id=? AND state NOT IN ('ready','skipped')`).run(id)
      this.database.prepare(`UPDATE work_pages SET state=CASE WHEN ocr_json IS NULL THEN 'ocr' ELSE 'translation' END,recovery_attempted=0 WHERE chapter_id IN (SELECT id FROM work_chapters WHERE work_id=?) AND state='review'`).run(id)
    })()
    if (action === 'favorite') this.database.prepare('UPDATE works SET favorite=?,updated_at=? WHERE id=?').run(favorite ? 1 : 0, now(), id)
    return true
  }
  refreshAll(userId: number) {
    const works = this.database.prepare('SELECT id FROM works WHERE user_id=?').all(userId) as Array<{id:number}>
    this.database.transaction(() => { for (const work of works) this.control(work.id,userId,'refresh') })()
    return works.length
  }
  pendingSync(excluded:number[] = []) { return this.database.prepare(`SELECT * FROM works WHERE sync_requested=1 AND sync_retry_after<=? ${excluded.length?`AND id NOT IN (${excluded.map(()=>'?').join(',')})`:''} ORDER BY updated_at,id LIMIT 1`).get(Date.now(),...excluded) as WorkRow | undefined }
  syncChapters(workId: number, chapters: SourceChapter[]) {
    return this.database.transaction(() => {
      const insert = this.database.prepare(`INSERT OR IGNORE INTO work_chapters(work_id,chapter_key,source_id,title,number,volume,language,position,page_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      const version = this.database.prepare('INSERT INTO work_source_versions VALUES(?,?,?,?) ON CONFLICT(work_id,chapter_key,source_id) DO UPDATE SET metadata_json=excluded.metadata_json')
      const reorder = this.database.prepare('UPDATE work_chapters SET position=? WHERE work_id=? AND chapter_key=?')
      let added = 0
      // Capítulos escolhidos ao adicionar: os demais ficam sem baixar até a pessoa pedir.
      const choice = JSON.parse((this.database.prepare('SELECT chapter_choice FROM works WHERE id=?').get(workId) as { chapter_choice: string | null } | undefined)?.chapter_choice || '[]') as Array<{ key: string; number: string | null }>
      const start = (this.database.prepare('SELECT start_number FROM works WHERE id=?').get(workId) as { start_number: number | null } | undefined)?.start_number ?? null
      const chosen = (chapter: SourceChapter) => !choice.length || choice.some((item) => item.key === chapter.key || (item.number !== null && item.number === chapter.number))
      for (const chapter of chapters) {
        const inserted = insert.run(workId, chapter.key, chapter.sourceId, chapter.title, chapter.number, chapter.volume, chapter.language, chapter.position, chapter.pageCount, now(), now()).changes
        if (inserted && !chosen(chapter)) this.database.prepare("UPDATE work_chapters SET state='skipped' WHERE work_id=? AND chapter_key=?").run(workId, chapter.key)
        // Capítulos antes de onde a pessoa parou já foram lidos fora do KOMA.
        if (inserted && start !== null && chapter.number !== null && Number(chapter.number) < start) this.database.prepare('UPDATE work_chapters SET read_done=1 WHERE work_id=? AND chapter_key=?').run(workId, chapter.key)
        added += inserted
        reorder.run(chapter.position, workId, chapter.key)
        for (const candidate of [chapter,...(chapter.alternatives || [])]) { const metadata = {...candidate}; delete metadata.alternatives; version.run(workId,chapter.key,candidate.sourceId,JSON.stringify(metadata)) }
      }
      if (choice.length && chapters.length) this.database.prepare('UPDATE works SET chapter_choice=NULL WHERE id=?').run(workId)
      this.database.prepare(`UPDATE works SET sync_requested=0,sync_attempts=0,sync_retry_after=0,last_synced_at=?,stage=CASE WHEN EXISTS(SELECT 1 FROM work_chapters WHERE work_id=? AND state NOT IN ('ready','partial','error','skipped')) THEN 'queued' WHEN EXISTS(SELECT 1 FROM work_chapters WHERE work_id=? AND state IN ('partial','error')) THEN 'partial' ELSE 'ready' END,message=?,updated_at=? WHERE id=?`).run(now(), workId, workId, chapters.length ? '' : 'A fonte não disponibiliza páginas para esta obra neste momento.', now(), workId)
      return added
    })()
  }
  stage(workId: number, stage: string, message = '') { this.database.prepare('UPDATE works SET stage=?,message=?,updated_at=? WHERE id=?').run(stage, message, now(), workId) }
  syncFailed(work: WorkRow, message: string, retryable: boolean) {
    const again = retryable && work.sync_attempts < 2
    this.database.prepare(`UPDATE works SET stage='error',message=?,sync_requested=?,sync_attempts=sync_attempts+1,sync_retry_after=? WHERE id=?`).run(message, again ? 1 : 0, Date.now() + 60000 * (work.sync_attempts + 1), work.id)
  }
  nextChapter(excluded:number[] = [], downloadedOnly = false, busyChapters: number[] = []) {
    return this.database.prepare(`SELECT c.* FROM work_chapters c JOIN works w ON w.id=c.work_id WHERE w.paused=0 AND w.sync_requested=0 AND c.state NOT IN ('ready','partial','error','rendering','skipped') AND c.retry_after<=? ${downloadedOnly ? `AND c.page_count>0 AND (SELECT COUNT(*) FROM work_pages p WHERE p.chapter_id=c.id AND p.image_id IS NOT NULL)=c.page_count AND (${SAME_LANGUAGE_SQL} OR NOT EXISTS(SELECT 1 FROM work_pages p WHERE p.chapter_id=c.id AND p.ocr_json IS NULL AND p.state NOT IN ('ready','review')))` : ''} ${excluded.length?`AND w.id NOT IN (${excluded.map(()=>'?').join(',')})`:''} ${busyChapters.length?`AND c.id NOT IN (${busyChapters.map(()=>'?').join(',')})`:''} ORDER BY w.last_processed_at,${READING_ORDER},c.position,c.id LIMIT 1`).get(Date.now(),...excluded,...busyChapters) as ChapterRow | undefined
  }
  nextDownload(excluded: number[] = [], busyChapters: number[] = []) {
    return this.database.prepare(`SELECT c.* FROM work_chapters c JOIN works w ON w.id=c.work_id
      WHERE w.paused=0 AND w.sync_requested=0 AND c.state NOT IN ('ready','partial','error','rendering','skipped')
      AND (c.state='blocked' OR c.retry_after<=?)
      AND (NOT EXISTS(SELECT 1 FROM work_pages p WHERE p.chapter_id=c.id)
        OR EXISTS(SELECT 1 FROM work_pages p WHERE p.chapter_id=c.id AND p.image_id IS NULL)
        OR (NOT ${SAME_LANGUAGE_SQL} AND EXISTS(SELECT 1 FROM work_pages p WHERE p.chapter_id=c.id AND p.ocr_json IS NULL AND p.state NOT IN ('ready','review'))))
      ${excluded.length ? `AND w.id NOT IN (${excluded.map(()=>'?').join(',')})` : ''}
      ${busyChapters.length ? `AND c.id NOT IN (${busyChapters.map(()=>'?').join(',')})` : ''}
      ORDER BY w.last_processed_at,${READING_ORDER},c.position,c.id LIMIT 1`).get(Date.now(),...excluded,...busyChapters) as ChapterRow | undefined
  }
  cooldown() {
    const row = this.database.prepare('SELECT retry_after AS retryAt,code,message FROM translation_cooldown WHERE id=1 AND retry_after>?').get(Date.now()) as { retryAt: number; code: string; message: string } | undefined
    return row ? {...row,manual:['user_denied','permission_revoked','provider_http_error','unsupported_operation'].includes(row.code)} : null
  }
  deferTranslation(code: string, message: string) {
    // O cofre limita chamadas por minuto e saída reservada por hora. Sem um
    // Retry-After no protocolo, respeitar a janela maior ao atingir a cota.
    const manual = ['user_denied','permission_revoked','provider_http_error','unsupported_operation'].includes(code)
    const retryAt = manual ? Number.MAX_SAFE_INTEGER : Date.now() + (code === 'quota_exceeded' ? 3600000 : 60000)
    this.database.prepare('INSERT INTO translation_cooldown VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET retry_after=excluded.retry_after,code=excluded.code,message=excluded.message').run(retryAt,code,message)
    return retryAt
  }
  chapter(id: number) { return this.database.prepare('SELECT * FROM work_chapters WHERE id=?').get(id) as ChapterRow | undefined }
  chapterStage(id: number, state: string, message = '', retryAfter = 0) { this.database.prepare('UPDATE work_chapters SET state=?,message=?,retry_after=?,updated_at=? WHERE id=?').run(state, message, retryAfter, now(), id) }
  section(chapterId: number, sectionId: number) { this.database.prepare('UPDATE work_chapters SET section_id=? WHERE id=?').run(sectionId, chapterId) }
  seedPages(chapterId: number, names: string[]) {
    this.database.transaction(() => {
      const insert = this.database.prepare(`INSERT OR IGNORE INTO work_pages(chapter_id,page_index,source_file) VALUES (?,?,?)`)
      names.forEach((name, index) => insert.run(chapterId, index, name))
      this.database.prepare('UPDATE work_chapters SET page_count=? WHERE id=?').run(names.length, chapterId)
    })()
  }
  pages(chapterId: number) { return this.database.prepare('SELECT * FROM work_pages WHERE chapter_id=? ORDER BY page_index').all(chapterId) as PageRow[] }
  downloaded(pageId: number, imageId: number, width: number, height: number) { this.database.prepare(`UPDATE work_pages SET image_id=?,width=?,height=?,state='ocr' WHERE id=?`).run(imageId, width, height, pageId) }
  recognized(pageId: number, data: unknown) { this.database.prepare(`UPDATE work_pages SET ocr_json=?,state='translation' WHERE id=?`).run(JSON.stringify(data), pageId) }
  pageReview(pageId: number, message: string) { this.database.prepare("UPDATE work_pages SET state='review',message=? WHERE id=?").run(message,pageId) }
  progressed(workId: number) { this.database.prepare('UPDATE works SET last_processed_at=? WHERE id=?').run(Date.now(),workId) }
  pageReady(pageId: number, message = '') { this.database.prepare(`UPDATE work_pages SET state='ready',message=? WHERE id=?`).run(message, pageId) }
  completeChapter(chapter: ChapterRow, renderBlocked: number[] = []) {
    // Só fica pronto depois que as páginas traduzidas estão desenhadas; até lá, "rendering".
    if (pendingRenderPages(this.database, chapter.id, renderBlocked) > 0) {
      this.chapterStage(chapter.id, 'rendering', 'Desenhando as páginas traduzidas.')
      this.stage(chapter.work_id, 'queued')
      return
    }
    const review = (this.database.prepare("SELECT COUNT(*) AS n FROM work_pages WHERE chapter_id=? AND state='review'").get(chapter.id) as {n:number}).n
    this.chapterStage(chapter.id, review ? 'partial' : 'ready', review ? `${review} página(s) com pendências. As demais foram preparadas; os trechos incertos permanecem no original.` : '')
    const remaining = this.database.prepare(`SELECT COALESCE(SUM(state NOT IN ('ready','partial','error','skipped')),0) AS pending,COALESCE(SUM(state='error'),0) AS errors,COALESCE(SUM(state='partial'),0) AS partial FROM work_chapters WHERE work_id=?`).get(chapter.work_id) as { pending: number; errors: number; partial: number }
    // Capítulo "partial" é legível: só algumas páginas ficaram com texto original.
    const message = remaining.pending ? '' : remaining.errors ? `${remaining.errors} capítulo(s) precisam de atenção. As páginas concluídas estão preservadas.` : remaining.partial ? `${remaining.partial} capítulo(s) têm páginas com texto não reconhecido, que ficaram no original. Todos podem ser lidos.` : ''
    this.stage(chapter.work_id, remaining.pending ? 'queued' : remaining.errors || remaining.partial ? 'partial' : 'ready', message)
  }
  alternate(chapter: ChapterRow, compatibleOnly = false): boolean {
    const rows = this.database.prepare(`SELECT v.source_id,v.metadata_json FROM work_source_versions v JOIN work_chapters c ON c.work_id=v.work_id AND c.chapter_key=v.chapter_key
      WHERE c.id=? AND v.source_id<>c.source_id AND v.source_id NOT IN (SELECT source_id FROM work_chapter_attempts WHERE chapter_id=c.id)
      ${compatibleOnly ? "AND json_extract(v.metadata_json,'$.language') IN ('pt-br','en','pt','es','es-la','fr','de','it','ja','ko','zh','zh-hk')" : ''}`).all(chapter.id) as Array<{source_id:string;metadata_json:string}>
    const target = (this.database.prepare('SELECT w.target_language FROM works w JOIN work_chapters c ON c.work_id=w.id WHERE c.id=?').get(chapter.id) as { target_language: string } | undefined)?.target_language || 'pt-br'
    const row = rows.map((item) => ({ ...item, metadata: JSON.parse(item.metadata_json) as SourceChapter }))
      .sort((a, b) => versionRank(a.metadata, target) - versionRank(b.metadata, target) || a.source_id.localeCompare(b.source_id))[0]
    const used = (this.database.prepare('SELECT version_attempts AS n FROM work_chapters WHERE id=?').get(chapter.id) as {n:number}).n
    if (!row || used >= MAX_VERSION_ATTEMPTS) return false
    const candidate = JSON.parse(row.metadata_json) as SourceChapter
    this.database.transaction(() => {
      this.database.prepare('INSERT INTO work_chapter_attempts(chapter_id,source_id,section_id,pages_json,created_at) VALUES(?,?,?,?,?)').run(chapter.id,chapter.source_id,chapter.section_id,JSON.stringify(this.pages(chapter.id)),now())
      this.database.prepare('DELETE FROM work_pages WHERE chapter_id=?').run(chapter.id)
      this.database.prepare(`UPDATE work_chapters SET source_id=?,language=?,page_count=?,section_id=NULL,state='queued',attempts=0,version_attempts=version_attempts+1,retry_after=0,message=? WHERE id=?`).run(candidate.sourceId,candidate.language,candidate.pageCount,'Tentando outra versão disponível do mesmo capítulo. Os arquivos anteriores foram preservados.',chapter.id)
    })()
    return true
  }
  // Abrir um capítulo coloca a obra no topo de "Continuar lendo".
  touch(workId: number, userId: number) {
    this.database.prepare('UPDATE works SET last_opened_at=? WHERE id=? AND user_id=?').run(now(), workId, userId)
  }
  /**
   * "Refazer este capítulo": apaga leitura, tradução e desenho do capítulo e o põe
   * na fila do zero, pelo mesmo caminho de uma obra nova. Os originais baixados ficam.
   * "download": capítulo não escolhido ao adicionar a obra entra na fila.
   */
  chapterAction(workId: number, chapterId: number, userId: number, action: 'redo' | 'download') {
    if (!this.row(workId, userId)) return false
    const chapter = this.database.prepare('SELECT id, state FROM work_chapters WHERE id=? AND work_id=?').get(chapterId, workId) as { id: number; state: string } | undefined
    if (!chapter) return false
    return this.database.transaction(() => {
      if (action === 'download') {
        if (chapter.state !== 'skipped') return false
        this.database.prepare("UPDATE work_chapters SET state='queued',attempts=0,retry_after=0,message='',updated_at=? WHERE id=?").run(now(), chapterId)
      } else {
        const images = 'SELECT image_id FROM work_pages WHERE chapter_id=? AND image_id IS NOT NULL'
        this.database.prepare(`DELETE FROM section_image_ocr_items WHERE section_image_id IN (${images})`).run(chapterId)
        this.database.prepare(`UPDATE section_images SET translated_path=NULL WHERE id IN (${images})`).run(chapterId)
        this.database.prepare("UPDATE work_pages SET ocr_json=NULL,state='translation',message='',recovery_attempted=0,upgrade_pending=0,render_stale=0 WHERE chapter_id=?").run(chapterId)
        this.database.prepare("UPDATE work_chapters SET state='queued',attempts=0,version_attempts=0,retry_after=0,message='',updated_at=? WHERE id=?").run(now(), chapterId)
      }
      this.database.prepare("UPDATE works SET stage='queued',paused=0,updated_at=? WHERE id=?").run(now(), workId)
      return true
    })()
  }
  markRead(workId: number, chapterId: number, userId: number) {
    if (!this.row(workId, userId)) return false
    const changed = this.database.prepare('UPDATE work_chapters SET read_done=1,updated_at=? WHERE id=? AND work_id=?').run(now(), chapterId, workId).changes
    if (changed) this.database.prepare('UPDATE works SET last_opened_at=? WHERE id=?').run(now(), workId)
    return Boolean(changed)
  }
}
export const worksRepository = new WorksRepository()
