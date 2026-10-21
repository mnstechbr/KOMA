import type { SqliteMigration } from './index'

// 0.4.44: página cujo único balão não tem texto legível (reticências, efeito,
// pedaço de balão) ficava "em revisão" e deixava o capítulo pendente para sempre.
// Se o capítulo tem outras falas traduzidas, não há o que traduzir ali: a página
// fica pronta com a original.
export const migration026UnreadableBalloons: SqliteMigration = {
  version: 26,
  name: 'unreadable_balloons',
  up: `
    UPDATE work_pages SET state='ready', message='Balão sem texto legível; original preservado.'
      WHERE state='review' AND message LIKE 'O OCR não conseguiu reconhecer o texto%'
        AND EXISTS (SELECT 1 FROM section_image_ocr_items o JOIN section_images i ON i.id=o.section_image_id JOIN work_chapters c ON c.section_id=i.section_id
          WHERE c.id=work_pages.chapter_id AND TRIM(o.translated_text)<>'');
    UPDATE work_chapters SET state='ready', message=''
      WHERE state='partial' AND NOT EXISTS (SELECT 1 FROM work_pages p WHERE p.chapter_id=work_chapters.id AND p.state<>'ready');
  `,
}
