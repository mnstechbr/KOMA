import type { SqliteMigration } from './index'

// 0.4.20: cada obra guarda o idioma para o qual é traduzida. Obras existentes
// continuam em português do Brasil; novas obras usam o idioma das Preferências.
export const migration018WorkTargetLanguage: SqliteMigration = {
  version: 18,
  name: 'work_target_language',
  up: `ALTER TABLE works ADD COLUMN target_language TEXT NOT NULL DEFAULT 'pt-br';`,
}
