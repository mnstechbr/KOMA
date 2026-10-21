import type { SqliteMigration } from './index'

// 0.4.24: obras com capítulos "partial" (legíveis, só algumas páginas no
// original) não aparecem mais como se precisassem de atenção.
export const migration020PartialMessage: SqliteMigration = {
  version: 20,
  name: 'partial_message',
  up: `
    UPDATE works SET message = (SELECT COUNT(*) FROM work_chapters c WHERE c.work_id = works.id AND c.state = 'partial')
      || ' capítulo(s) têm páginas com texto não reconhecido, que ficaram no original. Todos podem ser lidos.'
    WHERE stage = 'partial'
      AND NOT EXISTS (SELECT 1 FROM work_chapters c WHERE c.work_id = works.id AND c.state = 'error')
      AND NOT EXISTS (SELECT 1 FROM work_chapters c WHERE c.work_id = works.id AND c.state NOT IN ('ready','partial','error'));
  `,
}
