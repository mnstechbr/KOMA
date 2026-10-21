import type { SqliteMigration } from './index'

// 0.4.27: capítulo só fica pronto depois que as páginas traduzidas viram imagem.
// Os que estavam prontos com páginas ainda por desenhar passam a "rendering"
// e voltam a prontos sozinhos quando o desenho termina.
export const migration022RenderingState: SqliteMigration = {
  version: 22,
  name: 'rendering_state',
  up: `
    UPDATE work_chapters SET state='rendering', message='Desenhando as páginas traduzidas.'
    WHERE state IN ('ready','partial') AND EXISTS (
      SELECT 1 FROM work_pages p JOIN section_images i ON i.id=p.image_id JOIN works w ON w.id=work_chapters.work_id
      WHERE p.chapter_id=work_chapters.id AND p.state IN ('ready','review') AND p.ocr_json LIKE '%"lines"%'
        AND NOT (lower(work_chapters.language)=w.target_language OR (instr(w.target_language,'-')=0 AND lower(work_chapters.language) LIKE w.target_language||'-%'))
        AND i.translated_path IS NULL
        AND EXISTS (SELECT 1 FROM section_image_ocr_items o WHERE o.section_image_id=i.id AND TRIM(o.translated_text)<>''));
  `,
}
