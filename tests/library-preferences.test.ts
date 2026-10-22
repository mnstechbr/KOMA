import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { SQLITE_MIGRATIONS } from '../lib/backend/shared/migrations'
vi.mock('../lib/backend/shared/database.module', () => ({ db: null }))
import { readLibraryPreferences, updateLibraryPreference } from '../lib/backend/sections/library-preferences'

describe('preferências da biblioteca pessoal', () => {
  it('persiste favoritos e última abertura sem permitir alterar capítulo de outro usuário', () => {
    const db = new Database(':memory:')
    for (const migration of SQLITE_MIGRATIONS) db.exec(migration.up)
    const user = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, created_at, updated_at)
      VALUES ('Perfil local', 'teste@example.invalid', 'sem-login', '2026-01-01', '2026-01-01')`,
      )
      .run()
    const userId = Number(user.lastInsertRowid)
    db.prepare(
      `INSERT INTO sections (id, user_id, name, created_at, updated_at)
      VALUES (7, ?, 'Capítulo próprio', '2026-01-01', '2026-01-01')`,
    ).run(userId)
    expect(readLibraryPreferences(userId, db)).toEqual({ favorites: [], lastOpenedId: null })
    expect(updateLibraryPreference(userId + 1, 7, { favorite: true }, db)).toBeNull()
    expect(updateLibraryPreference(userId, 7, { favorite: true, opened: true }, db)).toEqual({ favorites: [7], lastOpenedId: 7 })
    expect(updateLibraryPreference(userId, 7, { favorite: true }, db)?.favorites).toEqual([7])
    expect(updateLibraryPreference(userId, 7, { favorite: false }, db)).toEqual({ favorites: [], lastOpenedId: 7 })
    expect(readLibraryPreferences(userId, db)).toEqual({ favorites: [], lastOpenedId: 7 })
    db.close()
  })
})
