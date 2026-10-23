import type { SqliteMigration } from './index'

// Capítulo listado por uma fonte só e pulado pelas outras (lib/backend/works/phantom-chapters.ts):
// 0 = normal, 1 = fantasma (dispensado, fora do total), 2 = a pessoa pediu para baixar mesmo assim.
export const migration029PhantomChapters: SqliteMigration = {
  version: 29,
  name: 'phantom_chapters',
  up: `
    ALTER TABLE work_chapters ADD COLUMN phantom INTEGER NOT NULL DEFAULT 0;
  `,
}
