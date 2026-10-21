import type { SqliteMigration } from './index'

// Páginas com diálogos traduzidos e algum balão ilegível passam a contar como
// prontas; capítulos sem outras pendências deixam de aparecer como parciais.
export const migration011PartialPagesReadable: SqliteMigration = {
  version: 11,
  name: 'partial_pages_readable',
  up: `
    UPDATE work_pages SET state='ready'
      WHERE state='review' AND message LIKE 'Alguns balões continuam ilegíveis%';
    UPDATE work_chapters SET state='ready', message=''
      WHERE state='partial' AND NOT EXISTS(SELECT 1 FROM work_pages p WHERE p.chapter_id=work_chapters.id AND p.state<>'ready');
  `,
}
