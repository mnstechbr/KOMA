import { parseDocument, DomUtils } from 'htmlparser2'
import type { AnyNode, Element } from 'domhandler'
import { seoTitles, type CatalogWork, type SourceChapter } from '@/lib/works'
import { checkedSourceUrl, sourceBytes, SourceError } from './source-http'

// Peças comuns aos conectores de sites (o modelo Madara e os conectores locais
// que o usuário mantém fora do repositório, que recebem este módulo como "kit").
export { sourceBytes, SourceError }
export const dom = { DomUtils, parseDocument }
export interface PageRef { name: string; url: string }
export interface AggregatorConnector {
  id: string
  name: string
  official: boolean
  /** O endereço é de uma obra desta fonte. */
  work: (url: string) => boolean
  /** O identificador de capítulo pertence a esta fonte. */
  owns: (chapterId: string) => boolean
  search: (query: string, signal?: AbortSignal) => Promise<Array<{ title: string; url: string }>>
  /** "known": capítulos já conhecidos; índices do mais novo ao mais antigo param neles. */
  chapters: (url: string, signal?: AbortSignal, known?: Set<string>) => Promise<SourceChapter[]>
  pages: (chapterId: string, signal?: AbortSignal) => Promise<PageRef[]>
}

export const hasClass = (node: Element, name: string) => (node.attribs?.class || '').split(/\s+/).includes(name)
export const text = (node: Element | null | undefined) => (node ? DomUtils.textContent(node) : '').replace(/\s+/g, ' ').trim()
export async function html(url: string, signal?: AbortSignal, options: Parameters<typeof sourceBytes>[4] = {}) {
  return parseDocument((await sourceBytes(url, false, signal, 0, options)).bytes.toString('utf8'))
}
export function chapterNumber(value: string) {
  const match = /\b(?:chapter|episode|ep|ch|cap[ií]tulo)\.?\s*(\d+(?:\.\d+)?)/i.exec(value) || /^#?\s*(\d+(?:\.\d+)?)\s*$/.exec(value.trim())
  return match ? match[1].replace(/^0+(?=\d)/, '') : null
}
export function chapter(sourceId: string, number: string | null, title = '', language = 'en'): SourceChapter {
  return { sourceId, key: number ? `chapter:${number}` : `special:${sourceId}`, number, volume: null, title, language, position: 0, pageCount: 0 }
}
export function ordered(chapters: SourceChapter[], label: string) {
  const unique = [...new Map(chapters.map((item) => [item.sourceId, item])).values()]
  if (!unique.length) throw new SourceError(`${label} não retornou o índice de capítulos.`, true)
  return unique.sort((a, b) => Number(a.number ?? 1e9) - Number(b.number ?? 1e9)).map((item, position) => ({ ...item, position }))
}
export function pageList(urls: string[], label: string): PageRef[] {
  if (!urls.length || urls.length > 2000) throw new SourceError(`${label} lista este capítulo, mas não disponibilizou as páginas.`, true, 'content_unavailable')
  if (new Set(urls).size !== urls.length) throw new SourceError(`${label} retornou páginas repetidas.`, true)
  return urls.map((url, index) => {
    const extension = /\.(jpe?g|png|webp|avif)$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase() || 'jpg'
    return { name: `page-${String(index + 1).padStart(4, '0')}.${extension}`, url }
  })
}
export function allowedImage(value: string, base: string, hosts: RegExp | ((host: string) => boolean), label: string) {
  const url = checkedSourceUrl(new URL(value.trim(), base).href)
  const allowed = typeof hosts === 'function' ? hosts(url.hostname) : hosts.test(url.hostname)
  if (!allowed) throw new SourceError(`${label} retornou uma imagem de outro serviço.`, false, 'destination_blocked')
  return url.href
}

const findClass = (nodes: AnyNode[], name: string) => DomUtils.findOne((node) => hasClass(node, name), nodes)
function content(nodes: AnyNode[], name: string) {
  const parent = findClass(nodes, name)
  return parent ? DomUtils.textContent(findClass(parent.children, 'summary-content') || parent).trim().slice(0, 12000) : ''
}

export interface MadaraSite {
  id: string
  name: string
  /** Endereço do site, sem barra no fim (https://exemplo.com). */
  origin: string
  /** Pasta das obras no endereço ("manga" em https://exemplo.com/manga/nome-da-obra/). */
  kind: string
  /** Servidores de imagem aceitos além do próprio site. */
  imageHost: (host: string) => boolean
}

/**
 * Sites feitos com o tema Madara (WordPress), o mais comum entre sites de leitura:
 * busca em "?s=", índice em "ajax/chapters" ou na própria página da obra, imagens
 * com carregamento atrasado e ficha da obra em "profile-manga".
 */
export function madara(site: MadaraSite) {
  const { origin, kind, name } = site
  const escaped = kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const workPath = new RegExp(`^/${escaped}/[a-z0-9-]+/$`)
  const chapterPath = new RegExp(`^/${escaped}/[a-z0-9-]+/[a-z0-9._-]+/$`)
  const workUrl = (slug: string) => `${origin}/${kind}/${slug}/`
  const slugOf = (url: string) => new URL(url).pathname.split('/')[2]
  const connector: AggregatorConnector = {
    id: site.id, name, official: false,
    work: (url) => { try { const u = new URL(url); return u.origin === origin && workPath.test(u.pathname) && !u.search } catch { return false } },
    owns: (chapterId) => { try { const u = new URL(chapterId); return u.origin === origin && chapterPath.test(u.pathname) && !workPath.test(u.pathname) } catch { return false } },
    async search(query, signal) {
      return (await catalogSearch(query, signal)).map((work) => ({ title: work.title, url: workUrl(work.sourceId.slice(site.id.length + 1)) }))
    },
    async chapters(url, signal) {
      if (!connector.work(url)) throw new SourceError(`Link de obra inválido para ${name}.`)
      // Índice na própria página da obra; versões novas do tema carregam por ajax.
      let items = parseChapters(await html(url, signal), url)
      if (!items.length) items = parseChapters(await html(`${url}ajax/chapters/`, signal, { method: 'POST', form: {}, headers: { 'X-Requested-With': 'XMLHttpRequest' } }), url)
      return ordered(items, name)
    },
    async pages(chapterId, signal) {
      if (!connector.owns(chapterId)) throw new SourceError(`Capítulo inválido para ${name}.`)
      return parsePages(await html(chapterId, signal), chapterId)
    },
  }
  function parseChapters(doc: ReturnType<typeof parseDocument>, url: string) {
    return DomUtils.findAll((node) => node.name === 'li' && hasClass(node, 'wp-manga-chapter'), doc.children).flatMap((item) => {
      const anchor = DomUtils.findOne((node) => node.name === 'a' && Boolean(node.attribs.href), item.children)
      const href = anchor ? new URL(anchor.attribs.href.trim(), url).href : ''
      if (!href || !connector.owns(href) || !href.startsWith(url)) return []
      const number = /\/chapter-(\d+(?:[.-]\d+)*)\/$/.exec(href)?.[1]?.replace(/-/g, '.') || chapterNumber(text(anchor))
      return [chapter(href, number)]
    })
  }
  function parsePages(doc: ReturnType<typeof parseDocument>, chapterId: string) {
    const reader = findClass(doc.children, 'reading-content')
    if (!reader) throw new SourceError(`${name} lista este capítulo, mas ainda não disponibilizou suas páginas.`, true, 'content_unavailable')
    const images = DomUtils.findAll((node) => node.name === 'img' && hasClass(node, 'wp-manga-chapter-img'), reader.children)
    const host = new URL(origin).hostname
    const urls = images.map((node) => (node.attribs['data-src'] || node.attribs['data-lazy-src'] || node.attribs.src || '').trim())
      .filter((value) => value && !/\/themes\/|loading\d*\.(svg|gif)/.test(value))
      .map((value) => allowedImage(value, chapterId, (item) => item === host || site.imageHost(item), name))
    // Algumas entradas recentes têm só créditos e um banner, sem a história.
    if (urls.length && urls.length <= 2 && urls.some((url) => /\/banner\./i.test(url))) throw new SourceError('Este capítulo contém apenas créditos ou aviso da fonte; as páginas da história ainda não estão disponíveis.', true, 'content_unavailable')
    return pageList(urls, name)
  }
  const summaryText = (nodes: AnyNode[]) => { const summary = findClass(nodes, 'summary__content'); return summary ? DomUtils.textContent(summary).trim() : '' }
  function mapWork(nodes: AnyNode[], url: string): CatalogWork {
    const titleNode = findClass(nodes, 'post-title') || DomUtils.findOne((node) => node.name === 'h1', nodes)
    const heading = titleNode && (DomUtils.findOne((node) => ['h1', 'h3'].includes(node.name), titleNode.children) || titleNode)
    const directTitle = heading?.children.filter((node) => node.type === 'text').map((node) => DomUtils.textContent(node)).join(' ').trim()
    const title = (directTitle || (heading ? DomUtils.textContent(heading) : '')).replace(/\s+/g, ' ').trim().slice(0, 400)
    if (!title) throw new SourceError('A fonte não retornou o título da obra.')
    const seo = seoTitles(summaryText(nodes))
    const aliases = [...new Set([...content(nodes, 'mg_alternative').split(/[,;\n]/).map((value) => value.trim()).filter(Boolean), ...seo.titles])].map((value) => ({ language: 'und', title: value }))
    const thumbnail = findClass(nodes, 'tab-thumb') || findClass(nodes, 'summary_image')
    const image = thumbnail && DomUtils.findOne((node) => node.name === 'img', thumbnail.children)
    let coverSourceUrl: string | undefined
    try {
      const candidate = checkedSourceUrl(new URL(image?.attribs['data-src'] || image?.attribs.src || '', origin).href)
      if (candidate.hostname === new URL(origin).hostname || site.imageHost(candidate.hostname)) coverSourceUrl = candidate.href
    } catch { /* Capa opcional; nunca carregar hosts de anúncios. */ }
    const genres = content(nodes, 'mg_genres').split(',').map((value) => value.trim()).filter(Boolean)
    const lower = genres.map((genre) => genre.toLowerCase())
    return {
      source: site.id, sourceName: name, sourceId: `${site.id}:${slugOf(url)}`, title, originalTitle: title, aliases,
      description: seo.rest.slice(0, 12000), descriptionLanguage: 'en',
      originalLanguage: lower.includes('manhwa') ? 'ko' : lower.includes('manhua') ? 'zh' : lower.includes('manga') ? 'ja' : 'und',
      authors: [content(nodes, 'mg_author'), content(nodes, 'mg_artists')].filter(Boolean), genres,
      year: null, coverFile: coverSourceUrl ? 'cover.jpg' : null, coverSourceUrl,
    }
  }
  function parseSearch(doc: ReturnType<typeof parseDocument>) {
    const entries = DomUtils.findAll((node) => hasClass(node, 'c-tabs-item__content'), doc.children)
    const results = new Map<string, CatalogWork>()
    for (const entry of entries.slice(0, 30)) {
      const heading = findClass(entry.children, 'post-title')
      const anchor = heading && DomUtils.findOne((node) => node.name === 'a', heading.children)
      if (!anchor || !connector.work(new URL(anchor.attribs.href, origin).href)) continue
      try { const work = mapWork(entry.children, new URL(anchor.attribs.href, origin).href); results.set(work.sourceId, work) }
      catch { /* Um resultado inválido não invalida os outros. */ }
    }
    // Tema sem a lista detalhada: só os títulos.
    if (!entries.length) for (const heading of DomUtils.findAll((node) => hasClass(node, 'post-title'), doc.children)) {
      const anchor = DomUtils.findOne((node) => node.name === 'a' && Boolean(node.attribs.href), heading.children)
      const href = anchor ? new URL(anchor.attribs.href, origin).href : ''
      if (!href || !connector.work(href)) continue
      const sourceId = `${site.id}:${slugOf(href)}`
      results.set(sourceId, { source: site.id, sourceName: name, sourceId, title: text(anchor), originalTitle: text(anchor), aliases: [], description: '', descriptionLanguage: 'en', originalLanguage: 'und', authors: [], genres: [], year: null, coverFile: null })
    }
    // Página de verificação ou erro no lugar da busca: a fonte não respondeu.
    if (!entries.length && !results.size && !/no posts|no results|nothing found|not found|no-posts|no manga/i.test(DomUtils.textContent(doc))) throw new SourceError(`${name} não retornou uma página de busca válida.`, true)
    return [...results.values()]
  }
  async function catalogSearch(query: string, signal?: AbortSignal) {
    return parseSearch(await html(`${origin}/?s=${encodeURIComponent(query)}&post_type=wp-manga`, signal))
  }
  async function catalogWork(sourceId: string, signal?: AbortSignal) {
    const url = workUrl(sourceId.slice(site.id.length + 1))
    const doc = await html(url, signal)
    const profile = findClass(doc.children, 'profile-manga') || findClass(doc.children, 'site-content') || doc
    const work = mapWork(profile.children, url)
    // Ficha sem os nomes alternativos: a frase de SEO da página inteira também vale.
    const seo = seoTitles(DomUtils.textContent(findClass(doc.children, 'summary__content') || profile))
    const known = new Set(work.aliases.map((alias) => alias.title))
    return { ...work, aliases: [...work.aliases, ...seo.titles.filter((title) => !known.has(title) && title !== work.title).map((title) => ({ language: 'und', title }))], description: seo.rest.slice(0, 12000) }
  }
  return { connector, catalogSearch, catalogWork, workUrl, parseChapters, parsePages, parseSearch }
}
