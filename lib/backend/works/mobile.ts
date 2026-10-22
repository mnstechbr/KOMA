import crypto from 'node:crypto'
import os from 'node:os'
import type Database from 'better-sqlite3'

// "Ler no celular": o app desktop abre um servidor só na rede de casa (Wi-Fi),
// com acesso por código, que mostra a biblioteca e o leitor em modo só leitura.
// Desligado por padrão; nada fica exposto à internet.
export interface MobileSettings {
  enabled: boolean
  port: number
  token: string
  code: string
}
const KEY = 'koma:mobile:v1'
export const MOBILE_PORT = 47321

const fresh = () => ({ token: crypto.randomBytes(16).toString('hex'), code: String(crypto.randomInt(0, 1000000)).padStart(6, '0') })
export function mobileSettings(database: Database.Database): MobileSettings {
  const row = database.prepare('SELECT value FROM kv_store WHERE key = ?').get(KEY) as { value: string } | undefined
  let stored: Partial<MobileSettings> = {}
  try {
    stored = row ? JSON.parse(row.value) : {}
  } catch {
    stored = {}
  }
  if (
    typeof stored.token === 'string' &&
    /^[0-9a-f]{32}$/.test(stored.token) &&
    typeof stored.code === 'string' &&
    /^\d{6}$/.test(stored.code)
  ) {
    return {
      enabled: stored.enabled === true,
      port: Number.isInteger(stored.port) && stored.port! >= 1024 && stored.port! <= 65535 ? stored.port! : MOBILE_PORT,
      token: stored.token,
      code: stored.code,
    }
  }
  const settings = { enabled: false, port: MOBILE_PORT, ...fresh() }
  save(database, settings)
  return settings
}
function save(database: Database.Database, settings: MobileSettings) {
  database
    .prepare(
      `INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = NULL`,
    )
    .run(KEY, JSON.stringify(settings))
}
/** Liga, desliga ou troca o código (os celulares conectados precisam entrar de novo). */
export function updateMobile(database: Database.Database, change: { enabled?: boolean; renew?: boolean }) {
  const current = mobileSettings(database)
  const next = { ...current, ...(typeof change.enabled === 'boolean' ? { enabled: change.enabled } : {}), ...(change.renew ? fresh() : {}) }
  save(database, next)
  return next
}

/** Endereços IPv4 da rede local (casa), sem os de máquinas virtuais e contêineres. */
export function localAddresses(interfaces = os.networkInterfaces()) {
  const privateRange = (address: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)
  return Object.entries(interfaces).flatMap(([name, list]) =>
    (list || [])
      .filter(
        (item) =>
          item.family === 'IPv4' &&
          !item.internal &&
          privateRange(item.address) &&
          !/^(docker|br-|veth|virbr|vmnet|vboxnet|podman|tun|tap|lo)/i.test(name),
      )
      .map((item) => item.address),
  )
}
