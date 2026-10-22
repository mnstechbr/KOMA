import https from 'node:https'
import dns from 'node:dns/promises'
import { isIP } from 'node:net'

export class SourceError extends Error {
  constructor(
    message: string,
    public readonly retryable = false,
    public readonly code = 'source_error',
  ) {
    super(message)
  }
}
// Servidores das fontes embutidas. Sites adicionados pelo usuário (fontes
// personalizadas e conectores locais) entram em tempo de execução.
const referers: Array<[RegExp, string]> = [
  [/^(image-comic\.pstatic\.net)$/, 'https://comic.naver.com/'],
  [/^webtoon-phinf\.pstatic\.net$/, 'https://www.webtoons.com/'],
]
const sourceHosts = new Set([
  'webtoon-phinf.pstatic.net',
  'image-comic.pstatic.net',
  'comic.naver.com',
  'page.kakao.com',
  'comic-walker.com',
  'yenpress.com',
  'www.webtoons.com',
  'www.kuaikanmanhua.com',
  'f1.kkmh.com',
  'f2.kkmh.com',
  'f3.kkmh.com',
  'f4.kkmh.com',
  'f5.kkmh.com',
  'tn1.kkmh.com',
  'shonenjumpplus.com',
  'cdn-ak-img.shonenjumpplus.com',
  'ac.qq.com',
  'www.lezhin.com',
  'mangaplus.shueisha.co.jp',
])
export interface SourceHostRule {
  allows: (host: string) => boolean
  referer?: string
}
// Compartilhado entre as cópias do módulo que o Next carrega em cada rota.
const shared = globalThis as typeof globalThis & { __komaSourceHosts?: Map<string, SourceHostRule> }
const dynamicHosts = (shared.__komaSourceHosts ||= new Map())
/** Libera os servidores de uma fonte adicionada pelo usuário (substitui o registro anterior do mesmo id). */
export function registerSourceHosts(id: string, rule: SourceHostRule | null) {
  if (rule) dynamicHosts.set(id, rule)
  else dynamicHosts.delete(id)
}
const dynamicRule = (host: string) =>
  [...dynamicHosts.values()].find((rule) => {
    try {
      return rule.allows(host)
    } catch {
      return false
    }
  })
export function isPublicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return (
      a > 0 &&
      a < 224 &&
      a !== 10 &&
      a !== 127 &&
      !(a === 169 && b === 254) &&
      !(a === 172 && b >= 16 && b <= 31) &&
      !(a === 192 && b === 168) &&
      !(a === 100 && b >= 64 && b <= 127) &&
      !(a === 198 && (b === 18 || b === 19)) &&
      !(a === 192 && b === 0) &&
      !(a === 198 && b === 51 && c === 100) &&
      !(a === 203 && b === 0 && c === 113)
    )
  }
  // Endereços públicos globais IPv6; rejeitar mapeamentos e faixas especiais.
  let canonical = ''
  try {
    canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1)
  } catch {
    return false
  }
  const groups = canonical.split(':')
  return (
    /^[23][0-9a-f]{3}:/i.test(canonical) &&
    !(groups[0] === '2001' && (parseInt(groups[1] || '0', 16) < 0x200 || groups[1] === 'db8')) &&
    !/^2002:|^3fff:/i.test(canonical)
  )
}
export function checkedSourceUrl(value: string) {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443') ||
    !(
      sourceHosts.has(url.hostname) ||
      dynamicRule(url.hostname) ||
      url.hostname === 'api.mangadex.org' ||
      url.hostname === 'uploads.mangadex.org' ||
      /^[a-z0-9-]+\.mangadex\.network$/.test(url.hostname)
    )
  )
    throw new SourceError('A fonte retornou um endereço de download não permitido.', false, 'destination_blocked')
  return url
}

let nextApiRequestAt = 0
let rateTail = Promise.resolve()
export interface SourceRequestOptions {
  method?: 'GET' | 'POST'
  form?: Record<string, string>
  headers?: Record<string, string>
}
// Conexões reaproveitadas (keep-alive) e no máximo IMAGE_SLOTS imagens ao mesmo
// tempo por site, somando todos os capítulos. Um site que responde 429 fica em
// espera pelo tempo que pediu (Retry-After) antes de receber outro pedido.
const IMAGE_SLOTS = 6
const network = ((
  globalThis as typeof globalThis & {
    __komaSourceNetwork?: {
      requests?: number
      agent: https.Agent
      busy: Map<string, number>
      waiting: Map<string, Array<() => void>>
      blockedUntil: Map<string, number>
    }
  }
).__komaSourceNetwork ||= {
  requests: 0,
  agent: new https.Agent({ keepAlive: true, maxSockets: 8, maxFreeSockets: 4, timeout: 60000 }),
  busy: new Map(),
  waiting: new Map(),
  blockedUntil: new Map(),
})
/** Pedidos feitos às fontes desde que o processo abriu (para medir a sincronização). */
export function sourceRequestCount() {
  return network.requests || 0
}
async function imageSlot(host: string, signal?: AbortSignal) {
  if ((network.busy.get(host) || 0) >= IMAGE_SLOTS)
    await new Promise<void>((resolve, reject) => {
      const queue = network.waiting.get(host) || []
      const wake = () => {
        signal?.removeEventListener('abort', stop)
        resolve()
      }
      const stop = () => {
        const list = network.waiting.get(host) || []
        list.splice(list.indexOf(wake), 1)
        reject(new SourceError('Processamento pausado.', false, 'paused'))
      }
      queue.push(wake)
      network.waiting.set(host, queue)
      signal?.addEventListener('abort', stop, { once: true })
    })
  network.busy.set(host, (network.busy.get(host) || 0) + 1)
  return () => {
    network.busy.set(host, Math.max(0, (network.busy.get(host) || 1) - 1))
    network.waiting.get(host)?.shift()?.()
  }
}
export async function sourceBytes(
  value: string,
  image = false,
  signal?: AbortSignal,
  redirects = 0,
  options: SourceRequestOptions = {},
): Promise<{ bytes: Buffer; mime: string }> {
  const host = checkedSourceUrl(value).hostname
  if ((network.blockedUntil.get(host) || 0) > Date.now())
    throw new SourceError('A fonte limitou as consultas. O KOMA aguardará antes de tentar novamente.', true)
  const release = image ? await imageSlot(host, signal) : null
  try {
    return await requestBytes(value, image, signal, redirects, options)
  } finally {
    release?.()
  }
}
async function requestBytes(
  value: string,
  image: boolean,
  signal: AbortSignal | undefined,
  redirects: number,
  options: SourceRequestOptions,
): Promise<{ bytes: Buffer; mime: string }> {
  const url = checkedSourceUrl(value)
  network.requests = (network.requests || 0) + 1
  if (url.hostname === 'api.mangadex.org') {
    const previous = rateTail
    let release!: () => void
    rateTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, nextApiRequestAt - Date.now())))
      nextApiRequestAt = Date.now() + 400
    } finally {
      release()
    }
  }
  if (signal?.aborted) throw new SourceError('Processamento pausado.', false, 'paused')
  const addresses = await dns.lookup(url.hostname, { all: true }).catch(() => {
    throw new SourceError('Não foi possível localizar a fonte. Confira a conexão.', true)
  })
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
    throw new SourceError('A fonte resolveu para um endereço privado ou inválido.', false, 'destination_blocked')
  const pinned = addresses.find((address) => address.family === 4) || addresses[0]
  const limit = image ? 24 * 1024 * 1024 : 8 * 1024 * 1024
  return new Promise((resolve, reject) => {
    const timeout = image ? 90000 : url.hostname === 'www.kuaikanmanhua.com' ? 60000 : 25000
    const deadline = AbortSignal.timeout(timeout)
    const referer = referers.find(([pattern]) => pattern.test(url.hostname))?.[1] || dynamicRule(url.hostname)?.referer
    const body = options.form ? new URLSearchParams(options.form).toString() : undefined
    const request = https.request(
      url,
      {
        method: options.method || 'GET',
        agent: network.agent,
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) KOMA/0.4 (personal desktop reader)',
          Accept: image ? 'image/*' : 'application/json,text/html',
          'Accept-Encoding': 'identity',
          ...(referer ? { Referer: referer } : {}),
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(Buffer.byteLength(body)) } : {}),
          ...(options.headers || {}),
        },
        lookup: ((_host: string, _options: unknown, callback: (error: Error | null, addresses: unknown, family?: number) => void) => {
          if ((_options as { all?: boolean })?.all) callback(null, [pinned])
          else callback(null, pinned.address, pinned.family)
        }) as NonNullable<https.RequestOptions['lookup']>,
      },
      (response) => {
        const status = response.statusCode || 500
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.resume()
          try {
            if (redirects >= 3) throw new SourceError('A fonte retornou redirecionamentos em excesso.')
            const destination = checkedSourceUrl(new URL(response.headers.location, url).href)
            // Revalidar DNS e manter o host de origem. Não seguir autenticação,
            // redirecionadores externos nem destinos privados.
            if (destination.hostname !== url.hostname)
              throw new SourceError('A fonte redirecionou para outro serviço.', false, 'destination_blocked')
            resolve(requestBytes(destination.href, image, signal, redirects + 1, options.method === 'POST' ? {} : options))
          } catch (error) {
            reject(error)
          }
          return
        }
        if (status !== 200) {
          response.resume()
          const retryable = status === 429 || status >= 500
          if (status === 429) {
            const wait = Math.min(300, Math.max(10, Number(response.headers['retry-after']) || 60)) * 1000
            network.blockedUntil.set(url.hostname, Date.now() + wait)
            if (url.hostname === 'api.mangadex.org') nextApiRequestAt = Date.now() + wait
          }
          reject(
            new SourceError(
              status === 429
                ? 'A fonte limitou as consultas. O KOMA aguardará antes de tentar novamente.'
                : `A fonte não disponibilizou este conteúdo (HTTP ${status}).`,
              retryable,
            ),
          )
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > limit) {
            request.destroy()
            reject(new SourceError('O arquivo da fonte ultrapassa o limite seguro de tamanho.'))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () =>
          resolve({ bytes: Buffer.concat(chunks), mime: String(response.headers['content-type'] || '').split(';')[0] }),
        )
        response.on('error', () => reject(new SourceError('A conexão com a fonte foi interrompida.', true)))
      },
    )
    request.setTimeout(timeout, () => {
      request.destroy()
      reject(new SourceError('A fonte demorou para responder. O trabalho será retomado.', true))
    })
    request.on('error', () =>
      reject(
        new SourceError(
          signal?.aborted ? 'Processamento pausado.' : 'Não foi possível conectar à fonte.',
          !signal?.aborted,
          signal?.aborted ? 'paused' : 'source_error',
        ),
      ),
    )
    request.end(body)
  })
}
export async function sourceJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const data = await sourceBytes(url, false, signal)
  try {
    return JSON.parse(data.bytes.toString('utf8')) as T
  } catch {
    throw new SourceError('A fonte retornou metadados inválidos.', true)
  }
}
