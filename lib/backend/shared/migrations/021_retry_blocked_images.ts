import type { SqliteMigration } from './index'

// 0.4.26: capítulos que falharam por nome de imagem recusado (ex.: "01(2).jpg")
// ou por erro temporário do site (HTTP 5xx) voltam para a fila.
export const migration021RetryBlockedImages: SqliteMigration = {
  version: 21,
  name: 'retry_blocked_images',
  up: `
    UPDATE work_chapters SET state='queued', attempts=0, retry_after=0, message=''
    WHERE state='error' AND (message LIKE '%imagem de capítulo não permitida%' OR message LIKE '%(HTTP 5%');
  `,
}
