import type Database from 'better-sqlite3'
import { DEFAULT_TARGET, DEFAULT_UI_LANGUAGE, isTargetLanguage, isUiLanguage, type TargetLanguage, type UiLanguage } from '@/lib/languages'

// Idioma da interface e idioma de tradução das novas obras.
export interface LanguageSettings {
  ui: UiLanguage
  target: TargetLanguage
}
const KEY = 'koma:language:v1'

export function getLanguageSettings(database: Database.Database): LanguageSettings {
  const row = database.prepare('SELECT value FROM kv_store WHERE key = ?').get(KEY) as { value: string } | undefined
  try {
    const value = row ? JSON.parse(row.value) : {}
    return {
      ui: isUiLanguage(value.ui) ? value.ui : DEFAULT_UI_LANGUAGE,
      target: isTargetLanguage(value.target) ? value.target : DEFAULT_TARGET,
    }
  } catch {
    return { ui: DEFAULT_UI_LANGUAGE, target: DEFAULT_TARGET }
  }
}

export function saveLanguageSettings(database: Database.Database, value: unknown): LanguageSettings {
  const item = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const current = getLanguageSettings(database)
  if (item.ui !== undefined && !isUiLanguage(item.ui)) throw new Error('Idioma da interface inválido.')
  if (item.target !== undefined && !isTargetLanguage(item.target)) throw new Error('Idioma de tradução inválido.')
  const next = { ui: (item.ui as UiLanguage) ?? current.ui, target: (item.target as TargetLanguage) ?? current.target }
  database
    .prepare(
      `INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = NULL`,
    )
    .run(KEY, JSON.stringify(next))
  return next
}
