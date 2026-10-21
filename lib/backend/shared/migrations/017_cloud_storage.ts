import type { SqliteMigration } from './index'

// 0.4.20: cópia de cada capítulo pronto na nuvem (um .cbz por capítulo). No
// modo "só na nuvem", evicted=1 indica que as páginas saíram do computador e
// serão baixadas de volta ao abrir o capítulo.
export const migration017CloudStorage: SqliteMigration = {
  version: 17,
  name: 'cloud_storage',
  up: `
    CREATE TABLE IF NOT EXISTS work_chapter_cloud (
      chapter_id INTEGER PRIMARY KEY,
      remote_path TEXT NOT NULL,
      signature TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      local_bytes INTEGER NOT NULL DEFAULT 0,
      uploaded_at TEXT NOT NULL,
      evicted INTEGER NOT NULL DEFAULT 0
    );
  `,
}
