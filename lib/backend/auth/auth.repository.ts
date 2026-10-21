import { db } from '@/lib/backend/shared/database.module'
import type { LocalUser } from './auth.types'

function mapUser(row: any): LocalUser {
  return {
    id: Number(row.id),
    name: String(row.name ?? ''),
    email: String(row.email ?? ''),
    role: Number(row.role ?? 0),
    limite: Number(row.limite ?? 0),
    gerado: Number(row.gerado ?? 0),
    limit_page_upload: Number(row.limit_page_upload ?? 0),
    foto: row.foto ? String(row.foto) : null,
  }
}

export class AuthRepository {
  getUserFromToken(token: string | null | undefined): LocalUser | null {
    if (!token) return null

    const row = db.prepare(`
      SELECT u.*
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
        AND s.expires_at > ?
      LIMIT 1
    `).get(token, new Date().toISOString()) as any

    if (!row) return null
    return mapUser(row)
  }
}
