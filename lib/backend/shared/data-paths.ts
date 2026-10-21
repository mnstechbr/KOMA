import path from 'node:path'

// Sem configuração, preserva o caminho da base original e instalações existentes.
export function getDataDir() {
  return path.resolve(process.env.KOMA_DATA_DIR || path.join(process.cwd(), 'storage'))
}
