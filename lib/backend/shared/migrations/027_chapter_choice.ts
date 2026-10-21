import type { SqliteMigration } from './index'

// 0.4.50: ao adicionar uma obra, a pessoa pode escolher quais capítulos baixar.
// A escolha vale na primeira busca de capítulos; os não escolhidos ficam como
// "skipped" (não baixados) até a pessoa pedir.
export const migration027ChapterChoice: SqliteMigration = {
  version: 27,
  name: 'chapter_choice',
  up: `
    ALTER TABLE works ADD COLUMN chapter_choice TEXT;
  `,
}
