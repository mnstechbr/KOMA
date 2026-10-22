import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import type Database from 'better-sqlite3'
import { db } from '../shared/database.module'

const OWNER_KEY = 'koma:desktop:owner:v1'

export function createDesktopSession(database: Database.Database = db) {
  return database.transaction(() => {
    const saved = database.prepare('SELECT value FROM kv_store WHERE key = ?').get(OWNER_KEY) as { value: string } | undefined
    let owner = saved
      ? (database.prepare('SELECT id FROM users WHERE id = ? AND role = 4').get(Number(saved.value)) as { id: number } | undefined)
      : undefined
    // Reutiliza o proprietário anterior sem mover capítulos nem modificar suas credenciais.
    owner ??= database.prepare('SELECT id FROM users WHERE role = 4 ORDER BY id LIMIT 1').get() as { id: number } | undefined
    const now = new Date().toISOString()
    if (!owner) {
      const result = database
        .prepare(
          `INSERT INTO users
        (name, email, password_hash, role, limite, gerado, limit_page_upload, created_at, updated_at)
        VALUES (?, ?, ?, 4, 100000, 0, 200, ?, ?)`,
        )
        .run(
          'Biblioteca pessoal',
          `local-${crypto.randomUUID()}@koma.invalid`,
          bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10),
          now,
          now,
        )
      owner = { id: Number(result.lastInsertRowid) }
    }
    database
      .prepare(
        `INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(OWNER_KEY, String(owner.id))
    const sessionToken = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)
    database
      .prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(sessionToken, owner.id, expiresAt, now)
    return { sessionToken, userId: owner.id }
  })()
}

export function isDesktopBootstrapAuthorized(request: Request) {
  const expected = process.env.KOMA_BOOTSTRAP_TOKEN
  const received = request.headers.get('x-koma-bootstrap-token') || ''
  if (process.env.KOMA_DESKTOP !== '1' || !expected || !received) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
