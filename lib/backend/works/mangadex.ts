import { type CatalogWork, type SourceChapter, titleScore } from '@/lib/works'
import { sourceBytes, sourceJson, SourceError, checkedSourceUrl } from './source-http'

export function sourceId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new SourceError('Identificador da obra ou capítulo inválido.')
  return value
}
type RecordValue = { id: string; attributes: Record<string, any>; relationships?: Array<{ type: string; id: string; attributes?: Record<string, any> }> }
function text(value: unknown, max = 12000) { return typeof value === 'string' ? value.slice(0, max) : '' }
const cleanDescription = (value: unknown) => text(value).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '')
function titleMap(value: unknown) { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, string> : {} }
export function mapCatalogWork(record: RecordValue): CatalogWork {
  const a = record.attributes
  const title = titleMap(a.title)
  const aliases = [title, ...(Array.isArray(a.altTitles) ? a.altTitles.map(titleMap) : [])].flatMap((map) => Object.entries(map).filter(([, title]) => typeof title === 'string').map(([language, title]) => ({ language, title: text(title, 400) })))
  const find = (language: string) => aliases.find((alias) => alias.language === language)?.title
  const descriptions = titleMap(a.description)
  const descriptionLanguage = descriptions['pt-br'] ? 'pt-br' : descriptions.pt ? 'pt' : descriptions.en ? 'en' : Object.keys(descriptions)[0] || ''
  const coverFile = record.relationships?.find((item) => item.type === 'cover_art')?.attributes?.fileName
  return {
    source: 'mangadex', sourceId: sourceId(record.id), title: find('pt-br') || find('en') || Object.values(title)[0] || 'Obra sem título',
    originalTitle: title[text(a.originalLanguage)] || Object.values(title)[0] || '', aliases,
    description: cleanDescription(descriptions[descriptionLanguage]), descriptionLanguage,
    descriptions: Object.fromEntries(Object.entries(descriptions).filter(([language, value]) => /^[a-z]{2}(-[a-z]{2})?$/.test(language) && typeof value === 'string' && value.trim()).slice(0, 12).map(([language, value]) => [language, cleanDescription(value)])),
    originalLanguage: text(a.originalLanguage, 16), authors: (record.relationships || []).filter((item) => item.type === 'author' || item.type === 'artist').map((item) => text(item.attributes?.name, 200)).filter(Boolean).filter((name, index, names) => names.indexOf(name) === index),
    genres: (Array.isArray(a.tags) ? a.tags : []).map((tag: { attributes?: { name?: Record<string, string> } }) => text(tag.attributes?.name?.['pt-br'] || tag.attributes?.name?.en, 80)).filter(Boolean),
    publicationLinks: ['raw','engtl'].flatMap((key) => {
      try { const url = new URL(a.links?.[key]); return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash ? [{ kind: key === 'raw' ? 'original' as const : 'licensed' as const, url: url.href }] : [] } catch { return [] }
    }),
    trackers: Object.fromEntries(['al', 'mal'].flatMap((key) => typeof a.links?.[key] === 'string' && /^\d{1,10}$/.test(a.links[key]) ? [[key, a.links[key]]] : [])),
    year: Number.isInteger(a.year) ? a.year : null, coverFile: typeof coverFile === 'string' && /^[a-zA-Z0-9._-]{1,200}$/.test(coverFile) ? coverFile : null,
  }
}
const includes = 'includes[]=cover_art&includes[]=author&includes[]=artist'
export async function searchCatalog(query: string, signal?: AbortSignal) {
  if (query.trim().length < 2 || query.length > 160) throw new SourceError('Digite de 2 a 160 caracteres para buscar a obra.')
  const result = await sourceJson<{ data: RecordValue[] }>(`https://api.mangadex.org/manga?limit=30&title=${encodeURIComponent(query.trim())}&hasAvailableChapters=true&${includes}`, signal)
  if (!Array.isArray(result.data)) throw new SourceError('A fonte não retornou resultados válidos.')
  return result.data.map(mapCatalogWork).sort((a, b) => titleScore(b, query) - titleScore(a, query))
}
export async function catalogWork(id: string, signal?: AbortSignal) {
  const result = await sourceJson<{ data: RecordValue }>(`https://api.mangadex.org/manga/${sourceId(id)}?${includes}`, signal)
  if (!result.data?.attributes) throw new SourceError('A obra não foi encontrada nesta fonte.')
  return mapCatalogWork(result.data)
}
// Preserve sufixos editoriais (1.10 ≠ 1.1) e numeração reiniciada por volume.
const chapterLabel = (value: string) => value.replace(/^0+(?=\d)/, '')
const priority = (language: string) => ({ 'pt-br': 0, en: 1, pt: 2, ja: 3, ko: 4, zh: 5, 'zh-hk': 6 }[language] ?? 10)
export function consolidateChapters(records: RecordValue[]): SourceChapter[] {
  const grouped = new Map<string, SourceChapter[]>()
  for (const record of records) {
    const a = record.attributes
    if (a.externalUrl || !Number.isInteger(a.pages) || a.pages < 1 || a.pages > 2000) continue
    const number = text(a.chapter, 40) || null
    const volume = text(a.volume, 40) || null
    const key = number ? `chapter:${chapterLabel(number)}${volume ? `:volume:${chapterLabel(volume)}` : ''}` : `special:${sourceId(record.id)}`
    const chapter: SourceChapter = { sourceId: sourceId(record.id), key, number, volume, title: text(a.title, 400), language: text(a.translatedLanguage, 16), position: number && Number.isFinite(Number(number)) ? Number(number) : 1e9 + grouped.size, pageCount: a.pages }
    grouped.set(key, [...(grouped.get(key) || []), chapter])
  }
  return [...grouped.values()].map((versions) => {
    versions.sort((a,b) => priority(a.language)-priority(b.language) || a.sourceId.localeCompare(b.sourceId))
    return { ...versions[0], alternatives: versions.slice(1) }
  }).sort((a, b) => (a.volume && b.volume && Number.isFinite(Number(a.volume)) && Number.isFinite(Number(b.volume)) ? Number(a.volume) - Number(b.volume) : 0) || a.position - b.position || a.number?.localeCompare(b.number || '') || a.sourceId.localeCompare(b.sourceId)).map((chapter, position) => ({ ...chapter, position }))
}
export async function listSourceChapters(id: string, signal?: AbortSignal) {
  const records: RecordValue[] = []
  for (let offset = 0; ; offset += 500) {
    if (offset > 9500) throw new SourceError('A fonte excedeu o limite de paginação. A obra exige um conector com paginação estendida.')
    const result = await sourceJson<{ data: RecordValue[]; total: number }>(`https://api.mangadex.org/manga/${sourceId(id)}/feed?limit=500&offset=${offset}&order[chapter]=asc&includeExternalUrl=0`, signal)
    if (!Array.isArray(result.data) || !Number.isInteger(result.total)) throw new SourceError('A lista de capítulos da fonte é inválida.')
    records.push(...result.data)
    if (records.length >= result.total) break
    if (result.data.length === 0) throw new SourceError('A fonte interrompeu a lista de capítulos. Tente atualizar novamente.', true)
  }
  return consolidateChapters(records)
}
export async function sourcePages(chapterId: string, signal?: AbortSignal) {
  const result = await sourceJson<{ baseUrl: string; chapter: { hash: string; data: string[] } }>(`https://api.mangadex.org/at-home/server/${sourceId(chapterId)}?forcePort443=true`, signal)
  const base = checkedSourceUrl(result.baseUrl)
  if (base.pathname !== '/' || base.search || !/^[a-f0-9]{32,64}$/.test(result.chapter?.hash) || !Array.isArray(result.chapter?.data) || result.chapter.data.length < 1 || result.chapter.data.length > 2000) throw new SourceError('A fonte retornou uma lista de páginas inválida.')
  return result.chapter.data.map((file) => {
    if (!/^[a-zA-Z0-9._-]{1,200}$/.test(file)) throw new SourceError('A fonte retornou um nome de página inválido.')
    return { name: file, url: `${base.origin}/data/${result.chapter.hash}/${file}` }
  })
}
export async function coverBytes(work: CatalogWork, signal?: AbortSignal) {
  if (!work.coverFile) return null
  return sourceBytes(`https://uploads.mangadex.org/covers/${sourceId(work.sourceId)}/${work.coverFile}.256.jpg`, true, signal)
}
