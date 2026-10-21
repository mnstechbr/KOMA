import type Database from 'better-sqlite3'
import { db } from '../shared/database.module'

export interface LibraryPreferences {
  favorites: number[]
  lastOpenedId: number | null
}

export function readLibraryPreferences(userId: number, database: Database.Database = db): LibraryPreferences {
  const row = database.prepare('SELECT value FROM kv_store WHERE key = ?').get(`koma:library:v1:user:${userId}`) as { value: string } | undefined
  try {
    const data = JSON.parse(row?.value || '{}')
    return {
      favorites: Array.isArray(data.favorites) ? data.favorites.filter((id: unknown) => Number.isInteger(id) && Number(id) > 0) : [],
      lastOpenedId: Number.isInteger(data.lastOpenedId) && data.lastOpenedId > 0 ? data.lastOpenedId : null,
    }
  } catch { return { favorites: [], lastOpenedId: null } }
}

export function updateLibraryPreference(userId: number, sectionId: number, patch: { favorite?: boolean; opened?: boolean }, database: Database.Database = db) {
  return database.transaction(() => {
    if (!database.prepare('SELECT id FROM sections WHERE id = ? AND user_id = ?').get(sectionId, userId)) return null
    const state = readLibraryPreferences(userId, database)
    const favorites = new Set(state.favorites)
    if (patch.favorite === true) favorites.add(sectionId)
    if (patch.favorite === false) favorites.delete(sectionId)
    const next = { favorites: [...favorites], lastOpenedId: patch.opened ? sectionId : state.lastOpenedId }
    database.prepare(`INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(`koma:library:v1:user:${userId}`, JSON.stringify(next))
    return next
  })()
}
