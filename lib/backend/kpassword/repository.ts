import { db } from '../shared/database.module'
import { defaultTranslationSettings, parseTranslationSettings, type KomaTranslationSettings } from './settings'

const KEY = 'koma:translation:kpassword:v1'
export function getTranslationSettings(): KomaTranslationSettings {
  const row = db.prepare('SELECT value FROM kv_store WHERE key = ?').get(KEY) as { value: string } | undefined
  if (!row) return defaultTranslationSettings()
  // Configuração corrompida não pode habilitar outro provedor ou consentimento.
  try {
    return parseTranslationSettings(JSON.parse(row.value))
  } catch {
    return defaultTranslationSettings()
  }
}
export function saveTranslationSettings(value: unknown) {
  const settings = parseTranslationSettings(value)
  db.prepare(
    `INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = NULL`,
  ).run(KEY, JSON.stringify(settings))
  return settings
}
