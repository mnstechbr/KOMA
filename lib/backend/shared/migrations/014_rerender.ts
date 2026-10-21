import type { SqliteMigration } from './index'

// 0.4.9: desenho refeito a partir das linhas do texto original. Todas as páginas
// geradas antes são redesenhadas; pendentes voltam para uma nova leitura.
export const migration014Rerender: SqliteMigration = {
  version: 14,
  name: 'rerender',
  up: `
    UPDATE section_images SET translated_path=NULL WHERE translated_path IS NOT NULL;
    UPDATE work_pages SET upgrade_pending=1 WHERE state='review' AND image_id IS NOT NULL;
  `,
}
