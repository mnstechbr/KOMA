import type Database from 'better-sqlite3'

// Coleta em segundo plano: o app desktop fica no ícone da bandeja ao fechar a
// janela, pode abrir com o computador, procura capítulos novos uma vez por dia a
// partir de um horário e avisa quando um capítulo novo fica pronto.
export interface BackgroundSettings {
  /** Fechar a janela mantém o KOMA no ícone da bandeja. */
  tray: boolean
  /** Abrir com o computador, já escondido na bandeja. */
  autostart: boolean
  /** Notificação do sistema quando um capítulo novo fica pronto. */
  notify: boolean
  /** Hora local (0–23) da procura diária por capítulos novos; null desliga. */
  checkHour: number | null
}
export const DEFAULT_BACKGROUND: BackgroundSettings = { tray: true, autostart: false, notify: true, checkHour: 3 }
const KEY = 'koma:background:v1'
const CHECK_KEY = 'koma:background-check:v1'
const NOTICES_KEY = 'koma:notices:v1'

const read = <T>(database: Database.Database, key: string): T | null => {
  const row = database.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined
  try { return row ? JSON.parse(row.value) as T : null } catch { return null }
}
const write = (database: Database.Database, key: string, value: unknown) => database.prepare(`INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = NULL`).run(key, JSON.stringify(value))

export function backgroundSettings(database: Database.Database): BackgroundSettings {
  const stored = read<Partial<BackgroundSettings>>(database, KEY) || {}
  const hour = stored.checkHour
  return {
    tray: typeof stored.tray === 'boolean' ? stored.tray : DEFAULT_BACKGROUND.tray,
    autostart: typeof stored.autostart === 'boolean' ? stored.autostart : DEFAULT_BACKGROUND.autostart,
    notify: typeof stored.notify === 'boolean' ? stored.notify : DEFAULT_BACKGROUND.notify,
    checkHour: hour === null ? null : Number.isInteger(hour) && hour! >= 0 && hour! <= 23 ? hour! : DEFAULT_BACKGROUND.checkHour,
  }
}
export function saveBackgroundSettings(database: Database.Database, next: Partial<BackgroundSettings>) {
  const current = backgroundSettings(database)
  const merged: BackgroundSettings = {
    tray: typeof next.tray === 'boolean' ? next.tray : current.tray,
    autostart: typeof next.autostart === 'boolean' ? next.autostart : current.autostart,
    notify: typeof next.notify === 'boolean' ? next.notify : current.notify,
    checkHour: next.checkHour === null ? null : Number.isInteger(next.checkHour) && next.checkHour! >= 0 && next.checkHour! <= 23 ? next.checkHour! : current.checkHour,
  }
  write(database, KEY, merged)
  return merged
}

/** Momento da procura de hoje (hora configurada, horário local). */
function todaysSlot(now: Date, hour: number) {
  const slot = new Date(now); slot.setHours(hour, 0, 0, 0)
  return slot
}
/**
 * Procura diária: depois da hora marcada, uma vez por dia, pede a atualização de
 * todas as obras. Com o computador desligado na hora marcada, a procura acontece
 * quando o KOMA abrir depois dela. Devolve quantas obras entraram na fila.
 */
export function scheduledCheck(database: Database.Database, refreshAll: (userId: number) => number, now = new Date()) {
  const { checkHour } = backgroundSettings(database)
  if (checkHour === null) return 0
  const slot = todaysSlot(now, checkHour)
  if (now < slot) return 0
  const last = read<{ at: string }>(database, CHECK_KEY)
  if (last && new Date(last.at) >= slot) return 0
  write(database, CHECK_KEY, { at: now.toISOString() })
  const users = database.prepare('SELECT DISTINCT user_id FROM works').all() as Array<{ user_id: number }>
  const total = users.reduce((sum, user) => sum + refreshAll(user.user_id), 0)
  if (total) console.info('[KOMA] Procura diária por capítulos novos', { works: total })
  return total
}

export interface ChapterNotice { workId: number; chapterId: number; title: string; number: string | null; count: number }
/**
 * Capítulos novos que ficaram prontos desde o último aviso, um aviso por obra.
 * Só contam capítulos descobertos depois da obra adicionada (não os da primeira
 * leva) e depois que os avisos foram ligados pela primeira vez.
 */
export function takeNotices(database: Database.Database): ChapterNotice[] {
  const state = read<{ baseline: number; sent: number[] }>(database, NOTICES_KEY)
  if (!state) {
    const max = (database.prepare('SELECT COALESCE(MAX(id),0) AS id FROM work_chapters').get() as { id: number }).id
    write(database, NOTICES_KEY, { baseline: max, sent: [] })
    return []
  }
  const rows = database.prepare(`SELECT c.id, c.work_id, c.number, w.title FROM work_chapters c JOIN works w ON w.id=c.work_id
    WHERE c.id > ? AND c.state = 'ready' AND julianday(c.created_at) - julianday(w.created_at) > 1.0/48 ORDER BY c.work_id, c.position`).all(state.baseline) as Array<{ id: number; work_id: number; number: string | null; title: string }>
  const sent = new Set(state.sent)
  const fresh = rows.filter((row) => !sent.has(row.id))
  if (!fresh.length) return []
  const notices = new Map<number, ChapterNotice>()
  for (const row of fresh) {
    const notice = notices.get(row.work_id)
    // Vários capítulos novos da mesma obra: um aviso, abrindo no primeiro deles.
    if (notice) notice.count++
    else notices.set(row.work_id, { workId: row.work_id, chapterId: row.id, title: row.title, number: row.number, count: 1 })
  }
  write(database, NOTICES_KEY, { baseline: state.baseline, sent: [...state.sent, ...fresh.map((row) => row.id)].slice(-2000) })
  return [...notices.values()]
}
