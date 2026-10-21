import type { SqliteMigration } from './index'

// Páginas traduzidas com a leitura antiga (sem linhas do texto) depois da
// migração 13 nunca eram desenhadas; e capítulos que esbarraram na fila cheia
// ficaram como erro definitivo. Ambos voltam para a fila.
export const migration015StuckPages: SqliteMigration = {
  version: 15,
  name: 'stuck_pages',
  up: `
    UPDATE work_pages SET upgrade_pending=1
      WHERE upgrade_pending=0 AND state IN ('ready','review') AND image_id IS NOT NULL
      AND (ocr_json IS NULL OR ocr_json NOT LIKE '%"lines"%')
      AND chapter_id IN (SELECT id FROM work_chapters WHERE lower(language)<>'pt-br')
      AND EXISTS(SELECT 1 FROM section_image_ocr_items o WHERE o.section_image_id=work_pages.image_id AND TRIM(o.translated_text)<>'');
    UPDATE work_pages SET ocr_json=NULL, state='ocr', recovery_attempted=0
      WHERE state='translation' AND ocr_json NOT LIKE '%"lines"%';
    UPDATE work_chapters SET state='queued', attempts=0, retry_after=0, message=''
      WHERE state='error' AND message LIKE '%aguardando tradução%';
  `,
}
