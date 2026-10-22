import type { SqliteMigration } from './index'

// 1.0: "Já está lendo?" ao adicionar uma obra. A fila prepara primeiro do
// capítulo em que a pessoa parou até o último e depois volta ao começo; os
// capítulos anteriores ficam marcados como lidos.
export const migration028ReadingFrom: SqliteMigration = {
  version: 28,
  name: 'reading_from',
  up: `
    ALTER TABLE works ADD COLUMN start_number REAL;
  `,
}
