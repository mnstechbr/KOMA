import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { SQLITE_MIGRATIONS } from '../lib/backend/shared/migrations'
import { backgroundSettings, saveBackgroundSettings, scheduledCheck, takeNotices } from '../lib/backend/works/background'

function library() {
  const database = new Database(':memory:')
  for (const migration of SQLITE_MIGRATIONS) database.exec(migration.up)
  database.prepare(`INSERT INTO users(id,name,email,password_hash,role,created_at,updated_at) VALUES(1,'Teste','t@example.invalid','h',4,'now','now')`).run()
  database.prepare(`INSERT INTO works(id,user_id,source,source_id,title,metadata_json,target_language,created_at,updated_at) VALUES(1,1,'mangadex','x','Obra','{}','pt-br','2026-10-01T10:00:00.000Z','2026-10-01T10:00:00.000Z')`).run()
  return database
}
const chapter = (database: Database.Database, id: number, created: string, state = 'ready') => database.prepare(`INSERT INTO work_chapters(id,work_id,source_id,chapter_key,number,title,language,position,page_count,state,created_at,updated_at) VALUES(?,1,?,?,?,'','en',?,1,?,?,?)`).run(id, `s${id}`, `chapter:${id}`, String(id), id, state, created, created)

describe('coleta em segundo plano', () => {
  it('guarda as preferências com padrões seguros', () => {
    const database = library()
    expect(backgroundSettings(database)).toEqual({ tray: true, autostart: false, notify: true, checkHour: 3 })
    expect(saveBackgroundSettings(database, { autostart: true, checkHour: 25 })).toEqual({ tray: true, autostart: true, notify: true, checkHour: 3 })
    expect(saveBackgroundSettings(database, { checkHour: null }).checkHour).toBeNull()
  })
  it('procura capítulos novos uma vez por dia, depois do horário marcado', () => {
    const database = library()
    let calls = 0
    const refresh = () => { calls++; return 1 }
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
