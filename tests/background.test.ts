import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { SQLITE_MIGRATIONS } from '../lib/backend/shared/migrations'
import { backgroundSettings, saveBackgroundSettings, scheduledCheck, takeNotices } from '../lib/backend/works/background'

function library() {
  const database = new Database(':memory:')
  for (const migration of SQLITE_MIGRATIONS) database.exec(migration.up)
  database
    .prepare(
      `INSERT INTO users(id,name,email,password_hash,role,created_at,updated_at) VALUES(1,'Teste','t@example.invalid','h',4,'now','now')`,
    )
    .run()
  database
    .prepare(
      `INSERT INTO works(id,user_id,source,source_id,title,metadata_json,target_language,created_at,updated_at) VALUES(1,1,'mangadex','x','Obra','{}','pt-br','2026-10-01T10:00:00.000Z','2026-10-01T10:00:00.000Z')`,
    )
    .run()
  return database
}
const chapter = (database: Database.Database, id: number, created: string, state = 'ready') =>
  database
    .prepare(
      `INSERT INTO work_chapters(id,work_id,source_id,chapter_key,number,title,language,position,page_count,state,created_at,updated_at) VALUES(?,1,?,?,?,'','en',?,1,?,?,?)`,
    )
    .run(id, `s${id}`, `chapter:${id}`, String(id), id, state, created, created)

describe('coleta em segundo plano', () => {
  it('guarda as preferências com padrões seguros', () => {
    const database = library()
    expect(backgroundSettings(database)).toEqual({ tray: true, autostart: false, notify: true, checkHour: 3 })
    expect(saveBackgroundSettings(database, { autostart: true, checkHour: 25 })).toEqual({
      tray: true,
      autostart: true,
      notify: true,
      checkHour: 3,
    })
    expect(saveBackgroundSettings(database, { checkHour: null }).checkHour).toBeNull()
  })
  it('procura capítulos novos uma vez por dia, depois do horário marcado', () => {
    const database = library()
    let calls = 0
    const refresh = () => {
      calls++
      return 1
    }
    expect(scheduledCheck(database, refresh, new Date(2026, 9, 22, 2, 30))).toBe(0)
    expect(scheduledCheck(database, refresh, new Date(2026, 9, 22, 10, 0))).toBe(1)
    expect(scheduledCheck(database, refresh, new Date(2026, 9, 22, 23, 0))).toBe(0)
    expect(scheduledCheck(database, refresh, new Date(2026, 9, 23, 3, 5))).toBe(1)
    expect(calls).toBe(2)
  })
  it('avisa só capítulos novos que ficaram prontos, um aviso por obra', () => {
    const database = library()
    chapter(database, 1, '2026-10-01T10:01:00.000Z')
    expect(takeNotices(database)).toEqual([])
    chapter(database, 2, '2026-10-05T03:00:00.000Z')
    chapter(database, 3, '2026-10-05T03:00:00.000Z')
    chapter(database, 4, '2026-10-05T03:00:00.000Z', 'queued')
    expect(takeNotices(database)).toEqual([{ workId: 1, chapterId: 2, title: 'Obra', number: '2', count: 2 }])
    expect(takeNotices(database)).toEqual([])
    database.prepare("UPDATE work_chapters SET state='ready' WHERE id=4").run()
    expect(takeNotices(database).map((notice) => notice.chapterId)).toEqual([4])
  })
})

describe('reportar erro no leitor', () => {
  it('guarda a página reportada uma vez por tipo de erro', async () => {
    const { addQualityReport, qualityReports } = await import('../lib/backend/works/quality-reports')
    const database = library()
    chapter(database, 1, '2026-10-01T10:01:00.000Z')
    database.prepare(`INSERT INTO sections(id,user_id,name,created_at,updated_at) VALUES(1,1,'s','now','now')`).run()
    database
      .prepare(
        `INSERT INTO section_images(id,section_id,order_index,original_name,mime,size_bytes,original_path,created_at,updated_at) VALUES(50,1,0,'a.jpg','image/jpeg',1,'/tmp/a.jpg','now','now')`,
      )
      .run()
    database.prepare(`INSERT INTO work_pages(id,chapter_id,page_index,source_file,image_id,state) VALUES(9,1,0,'a.jpg',50,'ready')`).run()
    expect(addQualityReport(database, 1, 9, 'english', 'sobrou WAIT')).toMatchObject({ image: 50, kind: 'english' })
    addQualityReport(database, 1, 9, 'english', 'sobrou WAIT de novo')
    addQualityReport(database, 1, 9, 'outside')
    expect(qualityReports(database).map((item) => [item.kind, item.note])).toEqual([
      ['english', 'sobrou WAIT de novo'],
      ['outside', ''],
    ])
    expect(addQualityReport(database, 2, 9, 'english')).toBeNull()
  })
})

describe('enviar o erro para o GitHub', () => {
  it('monta a issue só com texto, sem links nem marca do site, dentro do limite', async () => {
    const { issueLink, scrubText } = await import('../lib/backend/works/issue-link')
    expect(scrubText('READ AT https://evil.example/x OR leitorx.com NOW')).toBe('READ AT [link] OR [site] NOW')
    const database = new Database(':memory:')
    database.exec(
      'CREATE TABLE section_image_ocr_items (id INTEGER PRIMARY KEY, section_image_id INTEGER, ocr_text TEXT, translated_text TEXT)',
    )
    const insert = database.prepare('INSERT INTO section_image_ocr_items (section_image_id, ocr_text, translated_text) VALUES (50, ?, ?)')
    insert.run('THE PHOENIX IS BACK!', 'A Phoenix voltou!')
    insert.run('READ ON SOMESITE.COM', '')
    for (let index = 0; index < 80; index++) insert.run(`LINE ${index} `.repeat(30), `Fala ${index} `.repeat(30))
    const url = new URL(issueLink(database, 50, 'name', 'Phoenix deveria ser Fênix', { language: 'en', target: 'pt-br' }))
    expect(url.origin + url.pathname).toBe('https://github.com/mnstechbr/KOMA/issues/new')
    expect(url.href.length).toBeLessThanOrEqual(6000)
    expect(url.searchParams.get('template')).toBe('erro-de-traducao.yml')
    expect(url.searchParams.get('ocr')).toMatch(/^1\. THE PHOENIX IS BACK!/)
    expect(url.searchParams.get('ocr')).not.toMatch(/SOMESITE/)
    expect(url.searchParams.get('traducao')).toMatch(/^1\. A Phoenix voltou!/)
    expect(url.searchParams.get('idiomas')).toBe('en → pt-br')
  })
})

describe('painel de tempo das etapas', () => {
  it('guarda os últimos capítulos e calcula a média por página', async () => {
    const { recordStageTimes, stageReport } = await import('../lib/backend/works/stage-times')
    const database = library()
    chapter(database, 1, '2026-10-01T10:01:00.000Z')
    chapter(database, 2, '2026-10-01T10:01:00.000Z')
    recordStageTimes(database, { chapterId: 1, profile: 'maximo', pages: 10, downloadMs: 2000, ocrMs: 10000, translateMs: 3000 })
    recordStageTimes(database, { chapterId: 2, profile: 'maximo', pages: 30, downloadMs: 6000, ocrMs: 30000, translateMs: 1000 })
    const report = stageReport(database, 1)
    expect(report.chapters.map((item) => [item.chapterId, item.work])).toEqual([
      [2, 'Obra'],
      [1, 'Obra'],
    ])
    expect(report.average).toEqual({ pages: 40, downloadMs: 200, ocrMs: 1000, translateMs: 100 })
    expect(stageReport(database, 99).chapters).toEqual([])
  })
})

describe('progresso no AniList', () => {
  it('envia o maior capítulo lido e nunca diminui o progresso', async () => {
    const { connectAniList, syncAniListWork, anilistStatus } = await import('../lib/backend/works/anilist')
    const database = library()
    database.prepare('UPDATE works SET metadata_json=? WHERE id=1').run(JSON.stringify({ title: 'Obra', trackers: { al: '555' } }))
    chapter(database, 1, '2026-10-01T10:01:00.000Z')
    chapter(database, 2, '2026-10-01T10:01:00.000Z')
    chapter(database, 3, '2026-10-01T10:01:00.000Z')
    database.prepare('UPDATE work_chapters SET read_done=1 WHERE id IN (1,2)').run()
    let remote = 1
    const calls: string[] = []
    const fetcher = (async (_url: string, init?: RequestInit) => {
      const { query, variables } = JSON.parse(String(init?.body))
      calls.push(query.split('{')[0].trim())
      if (query.includes('Viewer')) return new Response(JSON.stringify({ data: { Viewer: { name: 'jean' } } }))
      if (query.includes('mediaListEntry'))
        return new Response(JSON.stringify({ data: { Media: { mediaListEntry: { progress: remote, status: 'CURRENT' } } } }))
      remote = variables.progress
      return new Response(JSON.stringify({ data: { SaveMediaListEntry: { id: 1 } } }))
    }) as unknown as typeof fetch
    expect(await connectAniList(database, 'x'.repeat(40), fetcher)).toBe('jean')
    expect(anilistStatus(database)).toMatchObject({ connected: true, viewer: 'jean' })
    expect(await syncAniListWork(database, 1, fetcher)).toBe('updated')
    expect(remote).toBe(2)
    remote = 10
    expect(await syncAniListWork(database, 1, fetcher)).toBe('up_to_date')
    expect(remote).toBe(10)
  })
})
