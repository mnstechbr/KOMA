import type { SqliteMigration } from './index'

// Até a 0.4.3 uma única fala marcada como incerta descartava a página inteira.
// Devolver essas páginas à fila de tradução; o OCR já salvo é reaproveitado.
export const migration009RetryRejectedPages: SqliteMigration = {
  version: 9,
  name: 'retry_rejected_pages',
  up: `
    UPDATE work_pages SET state='translation', message=''
      WHERE state='review' AND ocr_json IS NOT NULL AND (
        message LIKE '%precisa de revisão humana%' OR message LIKE '%omitiu ou acrescentou falas%'
        OR message LIKE '%alterou a identificação das falas%' OR message LIKE '%não concluiu todas as falas%'
        OR message LIKE '%não retornou a estrutura de tradução%');
    UPDATE work_chapters SET state='queued', attempts=0, retry_after=0, message=''
      WHERE state IN ('partial','error') AND EXISTS(SELECT 1 FROM work_pages p WHERE p.chapter_id=work_chapters.id AND p.state='translation');
    UPDATE works SET stage='queued', message=''
      WHERE stage IN ('partial','error') AND EXISTS(SELECT 1 FROM work_chapters c WHERE c.work_id=works.id AND c.state='queued');
  `,
}
