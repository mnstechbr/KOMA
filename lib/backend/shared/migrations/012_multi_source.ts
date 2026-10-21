import type { SqliteMigration } from './index'

// A 0.4.4 pesquisa a obra em várias fontes. Atualizar os índices e dar uma
// nova chance aos capítulos que falharam por falta de versão alternativa.
export const migration012MultiSource: SqliteMigration = {
  version: 12,
  name: 'multi_source',
  up: `
    UPDATE works SET sync_requested=1, sync_attempts=0, sync_retry_after=0;
    UPDATE work_chapters SET state='queued', attempts=0, version_attempts=0, retry_after=0, message=''
      WHERE state='error';
  `,
}
