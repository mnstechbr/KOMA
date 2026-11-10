import { type CatalogWork, normalizeTitle, seoTitles, titleScore } from '@/lib/works'
import { catalogWork, searchCatalog, sourceId, listSourceChapters } from './mangadex'
import { catalogFor, customCatalogs, localConnectors } from './custom-sources'
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
type Provider = { name: string; search: (query: string, signal?: AbortSignal) => Promise<CatalogWork[]> }
type Namer = { name: string; search: (query: string, signal?: AbortSignal) => Promise<Array<{ title: string; url: string }>> }
export async function searchAllCatalogs(
  query: string,
  signal?: AbortSignal,
  providers: Provider[] = [
    { name: 'MangaDex', search: searchCatalog },
    ...customCatalogs().map((catalog) => ({ name: catalog.name, search: catalog.search })),
  ],
  // Conectores locais não adicionam obras, mas conhecem outros nomes delas.
  namers: Namer[] = localConnectors().map((connector) => ({ name: connector.name, search: connector.search })),
) {
  if (query.trim().length < 2 || query.length > 160) throw new SourceError('Digite de 2 a 160 caracteres para buscar a obra.')
  const text = query.trim()
  const [replies, named] = await Promise.all([
    Promise.allSettled(providers.map((provider) => provider.search(text, signal))),
    Promise.allSettled(namers.map((namer) => namer.search(text, signal))),
  ])
  if (signal?.aborted) throw new SourceError('Busca interrompida.', false, 'paused')
  if (replies.every((reply) => reply.status === 'rejected'))
    throw new SourceError('Nenhuma fonte respondeu à busca. Tente novamente.', true)
  const found = replies.flatMap((reply) => (reply.status === 'fulfilled' ? reply.value : []))
  // A obra pode estar no catálogo com outra grafia ("Revo Barai" e "Ribobarai"):
  // os nomes que os outros sites dão a ela entram numa segunda busca.
  const others = otherNames(
    text,
    found,
    named.flatMap((reply) => (reply.status === 'fulfilled' ? reply.value : [])),
  )
  if (others.length) {
    const more = await Promise.allSettled(
      others.flatMap((name) =>
        providers.map((provider) => provider.search(name, signal).then((works) => works.filter((work) => nameOverlap(work, name) >= 0.6))),
      ),
    )
    if (signal?.aborted) throw new SourceError('Busca interrompida.', false, 'paused')
    found.push(...more.flatMap((reply) => (reply.status === 'fulfilled' ? reply.value : [])))
  }
  return {
    results: groupSameWork(
      [...new Map(found.map((work) => [work.sourceId, work])).values()].sort((a, b) => titleScore(b, text) - titleScore(a, text)),
    ),
    sources: replies.map((reply, index) => ({ name: providers[index].name, available: reply.status === 'fulfilled' })),
  }
}
const workNames = (work: CatalogWork) =>
  [work.title, work.originalTitle, ...(work.aliases || []).map((alias) => alias.title)].filter(Boolean).map(normalizeTitle)
const words = (value: string) => normalizeTitle(value).split(' ').filter(Boolean)
/** Parte das palavras do nome que aparecem em algum nome da obra (0 a 1). */
export function nameOverlap(work: CatalogWork, name: string) {
  const wanted = [...new Set(words(name))]
  if (!wanted.length) return 0
  return Math.max(
    0,
    ...workNames(work).map((value) => {
      const own = new Set(value.split(' '))
      return wanted.filter((word) => own.has(word)).length / wanted.length
    }),
  )
}
/** Corta no limite da busca sem partir palavra. */
function searchable(name: string) {
  const value = name.replace(/\s+/g, ' ').trim()
  return value.length <= 160 ? value : value.slice(0, 160).replace(/\s+\S*$/, '')
}
/**
 * Nomes da obra procurada vindos dos conectores locais que os catálogos ainda não
 * trouxeram: de cada endereço cujo nome contém todas as palavras da busca, todos os
 * nomes listados para ele (o site pode mostrar o original e o inglês). No máximo dois.
 */
export function otherNames(query: string, found: CatalogWork[], named: Array<{ title: string; url: string }>) {
  const wanted = words(query)
  const has = (title: string) => {
    const own = new Set(words(title))
    return wanted.every((word) => own.has(word))
  }
  const known = new Set(found.flatMap(workNames))
  // Já há no catálogo uma obra com todas as palavras da busca: nada a procurar.
  if ([...known].some((name) => wanted.every((word) => name.split(' ').includes(word)))) return []
  const urls = new Set(named.filter((item) => has(item.title)).map((item) => item.url))
  const names = named
    .filter((item) => urls.has(item.url))
    .sort((a, b) => Number(has(b.title)) - Number(has(a.title)))
    .map((item) => searchable(item.title))
    .filter((name) => name.length >= 2 && !known.has(normalizeTitle(name)))
  return [...new Map(names.map((name) => [normalizeTitle(name), name])).values()].slice(0, 2)
}
/**
 * A mesma obra vinda de fontes diferentes (MangaDex, sites adicionados) vira um
 * resultado só: o do MangaDex quando existe, com as outras fontes em "alsoIn".
 * Mesma obra = algum nome (principal, original ou alternativo) igual.
 */
export function groupSameWork(results: CatalogWork[]) {
  const names = (work: CatalogWork) =>
    new Set(
      [work.title, work.originalTitle, ...(work.aliases || []).map((alias) => alias.title), ...seoTitles(work.description || '').titles]
        .filter(Boolean)
        .map((name) => normalizeTitle(name).replace(/^the /, ''))
        .filter((name) => name.length >= 3),
    )
  const groups: Array<{ items: CatalogWork[]; names: Set<string> }> = []
  for (const work of results) {
    const own = names(work)
    const group = groups.find(
      (item) => item.items.every((other) => other.source !== work.source) && [...own].some((name) => item.names.has(name)),
    )
    if (group) {
      group.items.push(work)
      own.forEach((name) => group.names.add(name))
    } else groups.push({ items: [work], names: own })
  }
  return groups.map(({ items }) => {
    const primary = items.find((item) => item.source === 'mangadex') || items[0]
    const others = items.filter((item) => item !== primary)
    return others.length
      ? { ...primary, alsoIn: others.map((item) => ({ source: item.source, sourceName: item.sourceName, sourceId: item.sourceId })) }
      : primary
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
