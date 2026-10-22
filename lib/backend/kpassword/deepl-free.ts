import { db } from '@/lib/backend/shared/database.module'
import { decryptSecret, encryptSecret } from '@/lib/security/secrets'
import { prepare } from './google-free'
import { TranslationError } from './settings'

// DeepL API Free: chave da conta gratuita do DeepL (termina em ":fx"), guardada
// no KOMA com criptografia, como a do OpenRouter. Traduz fala por fala, como o
// Google grátis, dentro da franquia mensal da conta. Não serve como revisor.
const KEY = 'koma:deepl:api_key'
const API = 'https://api-free.deepl.com/v2'
// Limites do DeepL: até 50 textos e 128 KiB por pedido.
const BATCH_LINES = 50
const BATCH_CHARS = 30000
const RETRY_DELAYS = [5000, 20000, 60000]
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function deeplKey(database = db) {
  const row = database.prepare('SELECT value FROM kv_store WHERE key = ?').get(KEY) as { value: string } | undefined
  return row ? (decryptSecret(row.value) || '').trim() : ''
}
export function saveDeeplKey(apiKey: string, database = db) {
  database.prepare(`INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = NULL`).run(KEY, encryptSecret(apiKey))
}
export function clearDeeplKey(database = db) { database.prepare('DELETE FROM kv_store WHERE key = ?').run(KEY) }

// Códigos do DeepL: destino com variante (PT-BR, EN-US); origem só o idioma.
export function deeplTarget(code: string) {
  const value = code.toLowerCase()
  if (value === 'pt-br' || value === 'pt') return 'PT-BR'
  if (value === 'en') return 'EN-US'
  return value.split('-')[0].toUpperCase()
}
export function deeplSource(code: string) { return code === 'auto' ? undefined : code.split('-')[0].toUpperCase() }

/** Consumo da franquia mensal; null quando a chave não é aceita. */
export async function deeplUsage(apiKey = deeplKey(), fetcher: typeof fetch = fetch) {
  if (!apiKey) return null
  try {
    const response = await fetcher(`${API}/usage`, { headers: { Authorization: `DeepL-Auth-Key ${apiKey}` }, cache: 'no-store', signal: AbortSignal.timeout(15000) })
    if (!response.ok) return null
    const data = await response.json() as { character_count?: number; character_limit?: number }
    return { used: Number(data.character_count) || 0, limit: Number(data.character_limit) || 0 }
  } catch { return null }
}

async function requestDeepl(texts: string[], source: string, target: string, apiKey: string, fetcher: typeof fetch): Promise<string[]> {
  let response: Response
  try {
    response = await fetcher(`${API}/translate`, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `DeepL-Auth-Key ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texts, target_lang: deeplTarget(target), ...(deeplSource(source) ? { source_lang: deeplSource(source) } : {}) }),
    })
  } catch { throw new TranslationError('provider_unavailable', 'O DeepL não respondeu. A fila tenta de novo depois.', 503) }
  if (response.status === 456) throw new TranslationError('quota_exceeded', 'A franquia mensal do DeepL Free acabou. A fila espera a próxima.', 429)
  if (response.status === 429) throw new TranslationError('provider_unavailable', 'O DeepL limitou os pedidos por agora. A fila tenta de novo depois.', 503)
  if (response.status === 401 || response.status === 403) throw new TranslationError('invalid_credentials', 'O DeepL não aceitou a chave salva. Confira a chave do DeepL API Free nas Preferências.', 401)
  if (!response.ok) throw new TranslationError('provider_unavailable', `O DeepL respondeu com erro ${response.status}.`, 502)
  const data = await response.json() as { translations?: Array<{ text?: string }> }
  const translated = (data.translations || []).map((item) => (item.text || '').replace(/\r/g, '').trim())
  if (translated.length !== texts.length || translated.some((item) => !item)) throw new TranslationError('invalid_response', 'O DeepL devolveu uma resposta incompleta.', 502)
  return translated
}

export async function runDeeplFree(body: Record<string, unknown>, source: string, target: string, fetcher: typeof fetch = fetch, delays = RETRY_DELAYS, apiKey = deeplKey()): Promise<unknown> {
  if (!apiKey) throw new TranslationError('invalid_credentials', 'Salve a chave do DeepL API Free nas Preferências.', 401)
  const user = ((body.messages as Array<{ content: string }> | undefined) || []).map((message) => message.content).join('\n')
  const request = JSON.parse(user) as { lines: Array<{ id: number; text: string }>; proposal?: unknown }
  if (request.proposal) throw new TranslationError('unsupported_operation', 'O DeepL só traduz; escolha um modelo de IA para a revisão ou desligue a revisão.', 400)
  const prepared = request.lines.map((line) => ({ id: line.id, text: prepare(line.text) }))
  const translations: Array<{ id: number; text: string; needsReview: boolean }> = []
  for (let start = 0; start < prepared.length;) {
    const chunk: typeof prepared = []; let size = 0
    while (start + chunk.length < prepared.length && chunk.length < BATCH_LINES && (!chunk.length || size + prepared[start + chunk.length].text.length < BATCH_CHARS)) { size += prepared[start + chunk.length].text.length; chunk.push(prepared[start + chunk.length]) }
    for (let attempt = 0; ; attempt++) {
      try {
        const parts = await requestDeepl(chunk.map((line) => line.text), source, target, apiKey, fetcher)
        chunk.forEach((line, index) => translations.push({ id: line.id, text: parts[index], needsReview: false }))
        break
      } catch (error) {
        if (!(error instanceof TranslationError && error.code === 'provider_unavailable') || attempt >= delays.length) throw error
        await pause(delays[attempt])
      }
    }
    start += chunk.length
  }
  return { model: 'deepl-free', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations }) } }], usage: {} }
}
