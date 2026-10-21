import type { SqliteMigration } from './index'

// 0.4.31: página revisada sem nenhuma fala traduzida não tem o que redesenhar.
// Ela ficava presa como "em revisão"; agora mostra a original.
export const migration025StaleWithoutText: SqliteMigration = {
  version: 25,
  name: 'stale_without_text',
  up: `
    UPDATE section_images SET translated_path=NULL WHERE id IN (
      SELECT p.image_id FROM work_pages p WHERE p.render_stale=1
        AND NOT EXISTS (SELECT 1 FROM section_image_ocr_items o WHERE o.section_image_id=p.image_id AND TRIM(o.translated_text)<>''));
    UPDATE work_pages SET render_stale=0 WHERE render_stale=1
      AND NOT EXISTS (SELECT 1 FROM section_image_ocr_items o WHERE o.section_image_id=work_pages.image_id AND TRIM(o.translated_text)<>'');
  `,
}
