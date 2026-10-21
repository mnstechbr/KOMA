import { TranslationError } from './settings'

// Tradução pelo serviço público do Google Tradutor (o mesmo do modo legado),
// sem conta nem chave. Não há contexto da cena, correção de erros do OCR nem
// como "pular" créditos. Devolve a resposta no formato de chat/completions, para
// passar pela mesma validação dos modelos.
//
// O serviço bloqueia por um tempo quem manda pedidos demais. Por isso: muitas
// falas num pedido só (o Google devolve cada uma separada), um pedido de cada vez
// no app inteiro, um intervalo entre pedidos e espera crescente ao ser limitado.
// Um capítulo inteiro costuma sair em um ou dois pedidos.
const BATCH_LINES = 120
const BATCH_CHARS = 9000
const MIN_INTERVAL = 1000
const RETRY_DELAYS = [5000, 20000, 60000]
let queue: Promise<unknown> = Promise.resolve()
let last = 0
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
function slot<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = last + MIN_INTERVAL - Date.now()
    if (wait > 0) await pause(wait)
    try { return await task() } finally { last = Date.now() }
  })
  queue = run.catch(() => undefined)
  return run
}
// Mangá vem em maiúsculas, e o OCR ainda mistura caixas ("troUBlEsoME"). O
// Google lê maiúsculas como siglas e gritos: em caixa normal ele traduz melhor.
// O desenho põe a tradução de volta em maiúsculas quando o original é assim.
export function sentenceCase(text: string) {
  const letters = text.replace(/[^A-Za-z]/g, '')
  const mixed = /[a-z][A-Z]/.test(text.replace(/\bMc(?=[A-Z])/g, ''))
  if (letters.length < 2 || (!mixed && letters.replace(/[^A-Z]/g, '').length / letters.length < 0.3)) return text
  return text.toLowerCase().replace(/(^|[.!?…]\s+|^["'“(\s]+)(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase()).replace(/\bi\b/g, 'I')
}
const googleCode = (code: string) => (code === 'pt-br' ? 'pt' : code === 'auto' ? 'auto' : code.split('-')[0])

export async function translateLineWithGoogle(text: string, source: string, target: string, fetcher: typeof fetch = fetch, delays = RETRY_DELAYS) {
  return (await withRetries(() => requestGoogle([prepare(text)], source, target, fetcher), delays))[0]
}

// As falas chegam com uma quebra por linha do balão: juntas, a frase faz sentido.
const prepare = (text: string) => sentenceCase(text.replace(/\s*\n\s*/g, ' ').trim())

/** Várias falas num pedido; a resposta vem na mesma ordem, uma por fala. */
async function requestGoogle(texts: string[], source: string, target: string, fetcher: typeof fetch): Promise<string[]> {
  const query = new URLSearchParams({ client: 'gtx', sl: googleCode(source), tl: googleCode(target), format: 'text' })
  const body = new URLSearchParams(texts.map((text) => ['q', text]))
  let response: Response
  try { response = await fetcher(`https://translate.googleapis.com/translate_a/t?${query}`, { method: 'POST', cache: 'no-store', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: body.toString(), signal: AbortSignal.timeout(30000) }) }
  catch { throw new TranslationError('provider_unavailable', 'O Google Tradutor não respondeu. A fila tenta de novo depois.', 503) }
  if (response.status === 429) throw new TranslationError('quota_exceeded', 'O Google Tradutor limitou os pedidos por agora. A fila tenta de novo depois.', 429)
  if (!response.ok) throw new TranslationError('provider_unavailable', `O Google Tradutor respondeu com erro ${response.status}.`, 502)
  const payload = await response.json() as unknown
  // Com idioma de origem automático, cada item vem como [tradução, idioma detectado].
  const items = (Array.isArray(payload) ? payload : [payload]).map((entry) => (Array.isArray(entry) ? entry[0] : entry))
  const translated = items.map((item) => (typeof item === 'string' ? item.replace(/\r/g, '').trim() : ''))
  if (translated.length !== texts.length || translated.some((item) => !item)) throw new TranslationError('invalid_response', 'O Google Tradutor devolveu uma resposta incompleta.', 502)
  return translated
}

export async function runGoogleFree(body: Record<string, unknown>, source: string, target: string, fetcher: typeof fetch = fetch, delays = RETRY_DELAYS): Promise<unknown> {
  const user = ((body.messages as Array<{ content: string }> | undefined) || []).map((message) => message.content).join('\n')
  const request = JSON.parse(user) as { lines: Array<{ id: number; text: string }>; proposal?: unknown }
  // Revisão não faz sentido aqui: o Google não compara com uma proposta.
  if (request.proposal) throw new TranslationError('unsupported_operation', 'O Google Tradutor só traduz; escolha um modelo de IA para a revisão ou desligue a revisão.', 400)
  const prepared = request.lines.map((line) => ({ id: line.id, text: prepare(line.text) }))
  const translations: Array<{ id: number; text: string; needsReview: boolean }> = []
  for (let start = 0; start < prepared.length;) {
    const chunk: typeof prepared = []; let size = 0
    while (start + chunk.length < prepared.length && chunk.length < BATCH_LINES && (!chunk.length || size + prepared[start + chunk.length].text.length < BATCH_CHARS)) { size += prepared[start + chunk.length].text.length + 1; chunk.push(prepared[start + chunk.length]) }
    const parts = await withRetries(() => requestGoogle(chunk.map((line) => line.text), source, target, fetcher), delays)
    chunk.forEach((line, i) => translations.push({ id: line.id, text: parts[i], needsReview: false }))
    start += chunk.length
  }
  return { model: 'google-translate', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations }) } }], usage: {} }
}

async function withRetries<T>(task: () => Promise<T>, delays: number[]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await slot(task) }
    catch (error) {
      const retryable = error instanceof TranslationError && ['provider_unavailable', 'quota_exceeded'].includes(error.code)
      if (!retryable || attempt >= delays.length) throw error
      await pause(delays[attempt])
    }
  }
}
