import type { SqliteMigration } from './index'

// 0.4.8: páginas já traduzidas refazem o OCR (narração fora de balões) e
// ganham a imagem final em PT-BR, reaproveitando as traduções existentes.
export const migration013PageUpgrade: SqliteMigration = {
  version: 13,
  name: 'page_upgrade',
  up: `
    ALTER TABLE work_pages ADD COLUMN upgrade_pending INTEGER NOT NULL DEFAULT 0;
    UPDATE work_pages SET upgrade_pending=1
      WHERE state IN ('ready','review') AND ocr_json IS NOT NULL AND image_id IS NOT NULL
      AND chapter_id IN (SELECT id FROM work_chapters WHERE lower(language)<>'pt-br');
  `,
}
