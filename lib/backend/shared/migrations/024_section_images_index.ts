import type { SqliteMigration } from './index'

// 0.4.29: section_images não tinha índice por capítulo (seção). A lista de obras
// procurava a capa varrendo todas as imagens (~0,8 s por obra a cada 5 s).
export const migration024SectionImagesIndex: SqliteMigration = {
  version: 24,
  name: 'section_images_index',
  up: `CREATE INDEX IF NOT EXISTS idx_section_images_section ON section_images(section_id, order_index);`,
}
