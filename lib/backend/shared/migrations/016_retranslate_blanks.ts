import type { SqliteMigration } from './index'

// 0.4.14: apagamento sem vazar do balão e propaganda ignorada (todas as páginas
// são redesenhadas); balões deixados sem tradução voltam para a tradução com a
// nova instrução de corrigir erros de OCR pelo contexto.
export const migration016RetranslateBlanks: SqliteMigration = {
  version: 16,
  name: 'retranslate_blanks',
  up: `
    UPDATE section_images SET translated_path=NULL WHERE translated_path IS NOT NULL;
    UPDATE work_pages SET upgrade_pending=1
      WHERE image_id IS NOT NULL AND state IN ('ready','review')
      AND chapter_id IN (SELECT id FROM work_chapters WHERE lower(language)<>'pt-br')
      AND EXISTS(SELECT 1 FROM section_image_ocr_items o WHERE o.section_image_id=work_pages.image_id
        AND TRIM(o.translated_text)='' AND LENGTH(TRIM(o.ocr_text))>=3);
  `,
}
