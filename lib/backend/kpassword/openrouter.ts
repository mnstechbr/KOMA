import { openRouterService } from '../openrouter/openrouter.module'
import { TranslationError } from './settings'

// Tradução pelo OpenRouter com a chave guardada no KOMA (sem KPassword).
export async function runOpenRouter(body: Record<string, unknown>): Promise<unknown> {
  const apiKey = openRouterService.getApiKey()
  if (!apiKey) throw new TranslationError('not_configured', 'Cadastre a chave do OpenRouter nas Preferências.', 400)
  let response: Response
  try {
    response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(300000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
  } catch { throw new TranslationError('provider_unavailable', 'O OpenRouter não respondeu. A fila tenta de novo depois.', 503) }
  if (response.status === 401 || response.status === 403) throw new TranslationError('not_configured', 'O OpenRouter recusou a chave. Confira a chave nas Preferências.', 401)
  if (response.status === 402) throw new TranslationError('quota_exceeded', 'Sem crédito no OpenRouter para esse modelo.', 402)
  if (response.status === 429) throw new TranslationError('quota_exceeded', 'O OpenRouter limitou os pedidos por agora. A fila tenta de novo depois.', 429)
  if (!response.ok) throw new TranslationError('provider_unavailable', `O OpenRouter respondeu com erro ${response.status}.`, 502)
  return response.json()
}
