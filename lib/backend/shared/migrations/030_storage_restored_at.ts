import type { SqliteMigration } from './index'

// Dispositivo externo: capítulo antigo aberto volta para o computador e fica
// por um tempo (restored_at) antes de sair de novo.
export const migration030StorageRestoredAt: SqliteMigration = {
  version: 30,
  name: 'storage_restored_at',
  up: `
    ALTER TABLE work_chapter_cloud ADD COLUMN restored_at TEXT;
  `,
}
