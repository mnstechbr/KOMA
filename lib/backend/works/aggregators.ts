import { DomUtils } from 'htmlparser2'
import { sameLanguage } from '@/lib/languages'
import { normalizeTitle, seoTitles, type SourceChapter } from '@/lib/works'
import { SourceError } from './source-http'
import { allowedImage, chapter, chapterNumber, hasClass, html, ordered, pageList, text, type AggregatorConnector } from './aggregator-kit'

export type { AggregatorConnector, PageRef } from './aggregator-kit'

// Fontes alternativas pesquisadas automaticamente pelo título da obra. Cada
// uma é independente: falha, bloqueio ou ausência em uma não afeta as outras.
// Além do WEBTOON, entram as fontes que o usuário adiciona (ver custom-sources).

// Publicação oficial em inglês. Só episódios gratuitos aparecem na lista
// pública; episódios pagos não são obtidos.
const webtoons: AggregatorConnector = {
  id: 'webtoons',
  name: 'WEBTOON (oficial)',
  official: true,
  work: (url) => /^https:\/\/www\.webtoons\.com\/en\/(?!canvas\/)[a-z0-9-]+\/[a-z0-9-]+\/list\?title_no=\d+$/.test(url),
  owns: (chapterId) =>
    /^https:\/\/www\.webtoons\.com\/en\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/viewer\?title_no=\d+&episode_no=\d+$/.test(chapterId),
  async search(query, signal) {
    const doc = await html(`https://www.webtoons.com/en/search?keyword=${encodeURIComponent(query)}`, signal)
    const results = new Map<string, string>()
    for (const anchor of DomUtils.findAll((node) => node.name === 'a' && this.work(node.attribs.href || ''), doc.children)) {
      const title = text(DomUtils.findOne((node) => hasClass(node, 'title'), anchor.children))
      if (title && !results.has(anchor.attribs.href)) results.set(anchor.attribs.href, title)
    }
    return [...results].map(([url, title]) => ({ title, url }))
  },
  async chapters(url, signal, known) {
    if (!this.work(url)) throw new SourceError('Link de obra inválido para WEBTOON.')
    const items = new Map<string, SourceChapter>()
    for (let page = 1; page <= 200; page++) {
      const doc = await html(`${url}&page=${page}`, signal)
      let added = 0
      let fresh = 0
      for (const item of DomUtils.findAll((node) => node.name === 'li' && hasClass(node, '_episodeItem'), doc.children)) {
        const anchor = DomUtils.findOne((node) => node.name === 'a' && this.owns(node.attribs.href || ''), item.children)
        if (!anchor || items.has(anchor.attribs.href)) continue
        const title = text(DomUtils.findOne((node) => hasClass(node, 'subj'), item.children))
        // Numerar pelo título ("Episode 12"); sem número explícito, não mesclar com outras fontes.
        items.set(anchor.attribs.href, chapter(anchor.attribs.href, chapterNumber(title), title))
        added++
        if (!known?.has(anchor.attribs.href)) fresh++
      }
      // A lista vem do mais novo ao mais antigo: página sem episódio novo encerra a procura.
      if (!added || (known?.size && !fresh)) break
    }
    return ordered([...items.values()], 'WEBTOON')
  },
  async pages(chapterId, signal) {
    if (!this.owns(chapterId)) throw new SourceError('Capítulo inválido para WEBTOON.')
    const doc = await html(chapterId, signal)
    const urls = DomUtils.findAll((node) => node.name === 'img' && hasClass(node, '_images'), doc.children).map((node) =>
      allowedImage(node.attribs['data-url'] || '', chapterId, /^webtoon-phinf\.pstatic\.net$/, 'WEBTOON'),
    )
    return pageList(urls, 'WEBTOON')
  },
}

// Lista compartilhada entre as cópias do módulo que o Next carrega em cada rota;
// setUserConnectors troca as fontes do usuário sem trocar a referência.
const shared = globalThis as typeof globalThis & { __komaConnectors?: AggregatorConnector[] }
export const aggregators: AggregatorConnector[] = (shared.__komaConnectors ||= [webtoons])
/** Fontes do usuário depois do WEBTOON, na ordem de preferência. */
export function setUserConnectors(connectors: AggregatorConnector[]) {
  aggregators.splice(1, aggregators.length - 1, ...connectors.filter((connector) => connector.id !== 'webtoons'))
}
/** Ordem de preferência entre fontes (menor primeiro): oficial, MangaDex, alternativas. */
export function sourceRank(chapterId: string) {
  const index = aggregators.findIndex((connector) => connector.owns(chapterId))
  return index < 0 ? 1 : index === 0 ? 0 : index + 1
}
// Publicações originais com páginas públicas coletáveis.
const ORIGINAL_SOURCES = [/^https:\/\/comic\.naver\.com\//]
// Fontes que só servem de índice (páginas protegidas): última opção de versão.
const INDEX_ONLY = [/^https:\/\/shonenjumpplus\.com\//]
// Idiomas que o OCR instalado ainda não lê ficam por último.
const OCR_UNSUPPORTED = new Set<string>()
/**
 * Prioridade entre versões do mesmo capítulo: primeiro a fonte original, de
 * onde a obra é publicada; se o idioma dela não puder ser lido pelo OCR ou o
 * episódio não estiver aberto, o idioma de destino da obra, a edição oficial traduzida, MangaDex e
 * por fim os demais sites.
 */
export function versionRank(version: { sourceId: string; language: string }, target = 'pt-br') {
  const language = version.language.toLowerCase()
  if (INDEX_ONLY.some((pattern) => pattern.test(version.sourceId))) return 2000
  if (OCR_UNSUPPORTED.has(language)) return 1000 + sourceRank(version.sourceId)
  if (ORIGINAL_SOURCES.some((pattern) => pattern.test(version.sourceId))) return 0
  if (sameLanguage(language, target)) return 10 + sourceRank(version.sourceId)
  if (aggregators[0].owns(version.sourceId)) return 20
  return (language === 'en' ? 30 : 60) + sourceRank(version.sourceId)
}
export function aggregatorFor(chapterId: string) {
  return aggregators.find((connector) => connector.owns(chapterId))
}

/** Títulos conhecidos da obra para pesquisa, do mais ao menos provável. */
export function searchTitles(metadata: {
  title?: string
  originalTitle?: string
  aliases?: Array<{ language: string; title: string }>
  description?: string
}) {
  const preferred = ['en', 'ja-ro', 'ko-ro', 'zh-ro', 'und']
  // Nomes que o site só mostra na frase de SEO da descrição também valem para a busca.
  const aliases = [
    ...(metadata.aliases || []),
    ...seoTitles(metadata.description || '').titles.map((title) => ({ language: 'und', title })),
  ].sort((a, b) => (preferred.indexOf(a.language) + 1 || 99) - (preferred.indexOf(b.language) + 1 || 99))
  const titles = [
    metadata.title,
    ...aliases.filter((alias) => preferred.includes(alias.language)).map((alias) => alias.title),
    metadata.originalTitle,
  ]
  return [
    ...new Map(
      titles
        .filter((title): title is string => Boolean(title && /[a-z]/i.test(title)))
        .map((title) => [normalizeTitle(title), title.trim()]),
    ).values(),
  ]
}
/** Correspondência exata (ignorando artigo inicial e pontuação) com algum título conhecido. */
export function matchingResult(results: Array<{ title: string; url: string }>, titles: string[]) {
  const known = new Set(titles.map((title) => normalizeTitle(title).replace(/^the /, '')))
  return results.find((result) => known.has(normalizeTitle(result.title).replace(/^the /, '')))
}
export async function findOnAggregator(connector: AggregatorConnector, titles: string[], signal?: AbortSignal) {
  let lastError: unknown
  for (const title of titles.slice(0, 4)) {
    try {
      const match = matchingResult(await connector.search(title, signal), titles)
      if (match) return match
    } catch (error) {
      if (signal?.aborted) throw error
      lastError = error
    }
  }
  if (lastError) throw lastError
  return null
}
