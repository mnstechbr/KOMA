import type { CatalogWork } from '@/lib/works'
import { sourceBytes } from './source-http'

const SUPPORTED_PUBLICATION_HOSTS = new Set(['comic.naver.com', 'page.kakao.com', 'comic-walker.com', 'yenpress.com', 'www.webtoons.com'])
export async function inspectPublicationSources(work: CatalogWork, signal: AbortSignal) {
  const checks = []
  for (const reference of work.publicationLinks || []) {
    let status = 'connector_required'
    let message =
      'Publicação identificada. A coleta de páginas deste serviço ainda não tem conector; a alternativa disponível será consultada.'
    if (SUPPORTED_PUBLICATION_HOSTS.has(new URL(reference.url).hostname)) {
      try {
        await sourceBytes(reference.url, false, AbortSignal.any([signal, AbortSignal.timeout(8000)]))
      } catch {
        status = 'unavailable'
        message = 'A publicação foi identificada, mas a consulta pública não respondeu. A alternativa disponível será consultada.'
      }
    }
    checks.push({ ...reference, status, message })
  }
  return checks
}
