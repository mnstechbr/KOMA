import { type CatalogWork, titleScore } from '@/lib/works'
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
    results:replies.flatMap(reply=>reply.status==='fulfilled' ? reply.value : []).sort((a,b)=>titleScore(b,query)-titleScore(a,query)),
    sources:replies.map((reply,index)=>({name:providers[index].name,available:reply.status==='fulfilled'})),
  }
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
