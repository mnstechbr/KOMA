import type { SqliteMigration } from './index'

// 0.4.23: sites não oficiais passam a ser opcionais e desligados por padrão.
// Bibliotecas que já têm obras continuam com eles ligados, como antes.
export const migration019UnofficialSources: SqliteMigration = {
  version: 19,
  name: 'unofficial_sources',
  up: `INSERT OR IGNORE INTO kv_store (key, value, expires_at)
    SELECT 'koma:sources:v1', '{"unofficial":true}', NULL WHERE EXISTS (SELECT 1 FROM works);`,
}
