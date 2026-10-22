import type Database from 'better-sqlite3'

// Tempo de cada etapa dos últimos capítulos preparados (o mesmo do log
// "[KOMA] Etapas do capítulo"), para o painel de desempenho nas Preferências.
const KEY = 'koma:stage-times:v1'
const LIMIT = 100
export interface StageTimes {
  chapterId: number
  at: string
  profile: string
  pages: number
  downloadMs: number
  ocrMs: number
  translateMs: number
}

export function stageHistory(database: Database.Database): StageTimes[] {
  const row = database.prepare('SELECT value FROM kv_store WHERE key = ?').get(KEY) as { value: string } | undefined
  try {
    const list = row ? JSON.parse(row.value) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}
export function recordStageTimes(database: Database.Database, entry: Omit<StageTimes, 'at'>, at = new Date()) {
  const list = [...stageHistory(database).filter((item) => item.chapterId !== entry.chapterId), { ...entry, at: at.toISOString() }].slice(
    -LIMIT,
  )
  database
    .prepare(
      `INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = NULL`,
    )
    .run(KEY, JSON.stringify(list))
}

/** Últimos capítulos com obra e número, e a média por página de cada etapa. */
export function stageReport(database: Database.Database, userId: number) {
  const history = stageHistory(database).slice().reverse()
  const chapter = database.prepare(
    'SELECT c.number, c.title, w.title AS work FROM work_chapters c JOIN works w ON w.id=c.work_id WHERE c.id=? AND w.user_id=?',
  )
  const rows = history.flatMap((item) => {
    const found = chapter.get(item.chapterId, userId) as { number: string | null; title: string; work: string } | undefined
    return found ? [{ ...item, work: found.work, number: found.number }] : []
  })
  const pages = rows.reduce((sum, item) => sum + item.pages, 0)
  const per = (field: 'downloadMs' | 'ocrMs' | 'translateMs') =>
    pages ? Math.round(rows.reduce((sum, item) => sum + item[field], 0) / pages) : 0
  return {
    chapters: rows.slice(0, 30),
    average: { pages, downloadMs: per('downloadMs'), ocrMs: per('ocrMs'), translateMs: per('translateMs') },
  }
}
