import path from 'node:path'
import type Database from 'better-sqlite3'

// Onde ficam os capítulos prontos. "local" é o comportamento de sempre.
// Na nuvem ou num dispositivo externo (HD, SSD, pendrive, cartão, pasta de
// rede), o KOMA guarda um .cbz por capítulo na pasta escolhida.
export type StorageProvider = 'local' | 'gdrive' | 'onedrive' | 'rclone' | 'disk'
export type StorageMode = 'mirror' | 'cloud'
export interface StorageSettings {
  provider: StorageProvider
  /** Remoto do rclone do próprio usuário (ex.: "mega:"), só para provider = rclone. */
  remote: string
  folder: string
  mode: StorageMode
  /** Espaço máximo das páginas no computador no modo "só na nuvem", em GB. */
  cacheGb: number
  /** Dispositivo externo: código gravado em koma-disco.json, nome para mostrar e último caminho onde foi visto. */
  diskId: string
  diskLabel: string
  diskPath: string
  /** Dispositivo externo: quantos capítulos mais novos e quantos próximos não lidos de cada obra ficam no computador. */
  keepChapters: number
}

const KEY = 'koma:storage:v1'
export const DEFAULT_STORAGE: StorageSettings = {
  provider: 'local',
  remote: '',
  folder: 'KOMA',
  mode: 'mirror',
  cacheGb: 2,
  diskId: '',
  diskLabel: '',
  diskPath: '',
  keepChapters: 3,
}

export class StorageSettingsError extends Error {}

export function parseStorageSettings(value: unknown): StorageSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StorageSettingsError('Configuração de armazenamento inválida.')
  const item = value as Record<string, unknown>
  const provider = item.provider
  if (provider !== 'local' && provider !== 'gdrive' && provider !== 'onedrive' && provider !== 'rclone' && provider !== 'disk') throw new StorageSettingsError('Escolha um provedor de armazenamento da lista.')
  const remote = typeof item.remote === 'string' ? item.remote.trim() : ''
  if (provider === 'rclone' && !/^[A-Za-z0-9_][A-Za-z0-9_. -]{0,62}:$/.test(remote)) throw new StorageSettingsError('Informe o nome de um remoto do rclone terminado em dois-pontos, por exemplo mega:')
  const folder = typeof item.folder === 'string' && item.folder.trim() ? item.folder.trim() : DEFAULT_STORAGE.folder
  if (folder.length > 80 || /(^|\/)\.\.?(\/|$)|^\/|[\\:*?"<>|]/.test(folder)) throw new StorageSettingsError('Use um nome de pasta simples, sem barras invertidas nem "..".')
  const mode = item.mode === 'cloud' ? 'cloud' : 'mirror'
  const cacheGb = Number(item.cacheGb ?? DEFAULT_STORAGE.cacheGb)
  if (!Number.isFinite(cacheGb) || cacheGb < 0.5 || cacheGb > 500) throw new StorageSettingsError('O espaço no computador deve ficar entre 0,5 e 500 GB.')
  const keepChapters = Number(item.keepChapters ?? DEFAULT_STORAGE.keepChapters)
  if (!Number.isInteger(keepChapters) || keepChapters < 1 || keepChapters > 50) throw new StorageSettingsError('Escolha de 1 a 50 capítulos para manter no computador.')
  const disk = { diskId: '', diskLabel: '', diskPath: '' }
  if (provider === 'disk') {
    disk.diskId = typeof item.diskId === 'string' ? item.diskId : ''
    disk.diskLabel = typeof item.diskLabel === 'string' ? item.diskLabel.trim().slice(0, 120) : ''
    disk.diskPath = typeof item.diskPath === 'string' ? item.diskPath : ''
    if (!/^[0-9a-f-]{36}$/.test(disk.diskId) || !path.isAbsolute(disk.diskPath) || disk.diskPath.length > 1024 || disk.diskPath.includes('\0'))
      throw new StorageSettingsError('Escolha o dispositivo externo na lista.')
  }
  return { provider, remote: provider === 'rclone' ? remote : '', folder, mode, cacheGb, ...disk, keepChapters }
}

export function getStorageSettings(database: Database.Database): StorageSettings {
  const row = database.prepare('SELECT value FROM kv_store WHERE key = ?').get(KEY) as { value: string } | undefined
  if (!row) return { ...DEFAULT_STORAGE }
  try { return parseStorageSettings(JSON.parse(row.value)) } catch { return { ...DEFAULT_STORAGE } }
}

export function saveStorageSettings(database: Database.Database, value: unknown) {
  const settings = parseStorageSettings(value)
  database.prepare(`INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = NULL`).run(KEY, JSON.stringify(settings))
  return settings
}
