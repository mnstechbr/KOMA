import { db } from '@/lib/backend/shared/database.module'
import { decryptSecret, encryptSecret } from '@/lib/security/secrets'

// Chave do OpenRouter guardada no KOMA, criptografada. Serve para quem não usa
// a ponte do KPassword (no Windows ela não existe).
const OPENROUTER_KEY_KV = 'manga:openrouter:api_key'
const OLD_MODEL_KV = 'manga:openrouter:model'

export class OpenRouterRepository {
  getApiKey(): string | null {
    const row = db.prepare('SELECT value FROM kv_store WHERE key = ? LIMIT 1').get(OPENROUTER_KEY_KV) as { value?: string } | undefined
    if (!row?.value) return null
    const decrypted = decryptSecret(row.value)
    if (decrypted) return decrypted
    // Chave antiga gravada sem criptografia: regrava protegida.
    this.setApiKey(row.value)
    return row.value
  }

  setApiKey(apiKey: string) {
    db.prepare(`INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = NULL`).run(OPENROUTER_KEY_KV, encryptSecret(apiKey))
  }

  clear() {
    db.prepare('DELETE FROM kv_store WHERE key IN (?, ?)').run(OPENROUTER_KEY_KV, OLD_MODEL_KV)
  }
}
