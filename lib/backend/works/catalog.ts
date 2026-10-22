import { type CatalogWork, normalizeTitle, seoTitles, titleScore } from '@/lib/works'
import { catalogWork, searchCatalog, sourceId, listSourceChapters } from './mangadex'
import { catalogFor, customCatalogs } from './custom-sources'
import { SourceError } from './source-http'

// Identificadores do catálogo: o UUID do MangaDex ou "fonte:obra" de uma fonte
// personalizada (ex.: "site:nome-da-obra").
const CUSTOM_ID = /^[a-z0-9-]{1,40}:[a-z0-9-]{1,180}$/
export function validateCatalogId(value: unknown): string {
  if (typeof value === 'string' && CUSTOM_ID.test(value)) return value
  return sourceId(value)
}
function customCatalog(id: string) {
  const catalog = catalogFor(id)
  if (!catalog) throw new SourceError('A fonte desta obra não está mais nas suas fontes personalizadas.')
  return catalog
}
export async function searchAllCatalogs(query: string, signal?: AbortSignal, providers: Array<{ name: string; search: (query: string, signal?: AbortSignal) => Promise<CatalogWork[]> }> = [
  { name: 'MangaDex', search: searchCatalog }, ...customCatalogs().map((catalog) => ({ name: catalog.name, search: catalog.search })),
]) {
  if (query.trim().length < 2 || query.length > 160) throw new SourceError('Digite de 2 a 160 caracteres para buscar a obra.')
  const replies = await Promise.allSettled(providers.map(provider=>provider.search(query.trim(),signal)))
  if (signal?.aborted) throw new SourceError('Busca interrompida.',false,'paused')
  if (replies.every(reply=>reply.status==='rejected')) throw new SourceError('Nenhuma fonte respondeu à busca. Tente novamente.',true)
  return {
    results:groupSameWork(replies.flatMap(reply=>reply.status==='fulfilled' ? reply.value : []).sort((a,b)=>titleScore(b,query)-titleScore(a,query))),
    sources:replies.map((reply,index)=>({name:providers[index].name,available:reply.status==='fulfilled'})),
  }
}
/**
 * A mesma obra vinda de fontes diferentes (MangaDex, sites adicionados) vira um
 * resultado só: o do MangaDex quando existe, com as outras fontes em "alsoIn".
 * Mesma obra = algum nome (principal, original ou alternativo) igual.
 */
export function groupSameWork(results: CatalogWork[]) {
  const names = (work: CatalogWork) => new Set([work.title, work.originalTitle, ...(work.aliases || []).map((alias) => alias.title), ...seoTitles(work.description || '').titles]
    .filter(Boolean).map((name) => normalizeTitle(name).replace(/^the /, '')).filter((name) => name.length >= 3))
  const groups: Array<{ items: CatalogWork[]; names: Set<string> }> = []
  for (const work of results) {
    const own = names(work)
    const group = groups.find((item) => item.items.every((other) => other.source !== work.source) && [...own].some((name) => item.names.has(name)))
    if (group) { group.items.push(work); own.forEach((name) => group.names.add(name)) }
    else groups.push({ items: [work], names: own })
  }
  return groups.map(({ items }) => {
    const primary = items.find((item) => item.source === 'mangadex') || items[0]
    const others = items.filter((item) => item !== primary)
    return others.length ? { ...primary, alsoIn: others.map((item) => ({ source: item.source, sourceName: item.sourceName, sourceId: item.sourceId })) } : primary
  })
}
export async function catalogMetadata(id: string, signal?: AbortSignal) {
  validateCatalogId(id)
  return CUSTOM_ID.test(id) ? customCatalog(id).work(id, signal) : catalogWork(id, signal)
}
export function catalogChapters(id: string, signal?: AbortSignal) {
  validateCatalogId(id)
  if (!CUSTOM_ID.test(id)) return listSourceChapters(id, signal)
  const catalog = customCatalog(id)
  return catalog.chaptersOf(id, signal)
}
/** Endereço da obra numa fonte personalizada ("site:obra"), ou null para o MangaDex. */
export function customWorkUrl(id: string) {
  if (!CUSTOM_ID.test(id)) return null
  const catalog = catalogFor(id)
  return catalog ? { name: catalog.name, provider: catalog.id, url: catalog.workUrl(id.slice(catalog.id.length + 1)) } : null
}
