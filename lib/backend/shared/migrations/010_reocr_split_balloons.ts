import type { SqliteMigration } from './index'

// A 0.4.4 une balões que o detector cortava ao meio. Páginas ainda não
// traduzidas refazem o OCR local; páginas prontas não são alteradas.
export const migration010ReocrSplitBalloons: SqliteMigration = {
  version: 10,
  name: 'reocr_split_balloons',
  up: `
    UPDATE work_pages SET ocr_json=NULL, state='ocr', recovery_attempted=0, message=''
      WHERE state='translation' AND image_id IS NOT NULL;
  `,
}
