import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SQLITE_MIGRATIONS } from '../lib/backend/shared/migrations'

vi.mock('../lib/backend/shared/database.module', () => ({ db: null }))
import { createDesktopSession, isDesktopBootstrapAuthorized } from '../lib/backend/auth/desktop-profile'

function database() {
  const db = new Database(':memory:')
  for (const migration of SQLITE_MIGRATIONS) db.exec(migration.up)
  return db
}

afterEach(() => vi.unstubAllEnvs())
describe('biblioteca desktop automática', () => {
  it('cria o perfil interno uma vez e abre sessões sem dados de cadastro', () => {
    const db = database()
    const first = createDesktopSession(db)
    const next = createDesktopSession(db)
    expect(next.userId).toBe(first.userId)
    expect(next.sessionToken).not.toBe(first.sessionToken)
    expect(db.prepare('SELECT COUNT(*) AS total FROM users').get()).toEqual({ total: 1 })
    expect(db.prepare('SELECT name FROM users').get()).toEqual({ name: 'Biblioteca pessoal' })
    db.close()
  })
  it('reutiliza o proprietário existente sem alterar sua biblioteca ou credenciais', () => {
    const db = database()
    db.prepare(`INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at)
      VALUES (42, 'Nome existente', 'pessoal@example.invalid', 'hash-anterior', 4, '2026-01-01', '2026-01-01')`).run()
    expect(createDesktopSession(db).userId).toBe(42)
    expect(db.prepare('SELECT password_hash FROM users WHERE id = 42').get()).toEqual({ password_hash: 'hash-anterior' })
    expect(db.prepare('SELECT COUNT(*) AS total FROM users').get()).toEqual({ total: 1 })
    db.close()
  })
  it('exige o segredo efêmero da janela e não permite bootstrap no modo web', () => {
    vi.stubEnv('KOMA_BOOTSTRAP_TOKEN', 'segredo-de-teste')
    const request = new Request('http://127.0.0.1:3080/api/local/bootstrap', { headers: { 'x-koma-bootstrap-token': 'segredo-de-teste' } })
    expect(isDesktopBootstrapAuthorized(request)).toBe(false)
    vi.stubEnv('KOMA_DESKTOP', '1')
    expect(isDesktopBootstrapAuthorized(request)).toBe(true)
    expect(isDesktopBootstrapAuthorized(new Request(request.url))).toBe(false)
    expect(isDesktopBootstrapAuthorized(new Request(request.url, { headers: { 'x-koma-bootstrap-token': 'segredo-incorreto' } }))).toBe(false)
  })
})
