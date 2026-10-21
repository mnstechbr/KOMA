import type { SqliteMigration } from './index'

// 0.4.28: página com OCR refeito é redesenhada sem sumir do leitor. A imagem
// traduzida anterior continua até a nova ficar pronta.
export const migration023RenderStale: SqliteMigration = {
  version: 23,
  name: 'render_stale',
  up: `ALTER TABLE work_pages ADD COLUMN render_stale INTEGER NOT NULL DEFAULT 0;`,
}
