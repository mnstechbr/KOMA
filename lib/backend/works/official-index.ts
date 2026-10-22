import { parseDocument, DomUtils } from 'htmlparser2'
import { findData } from './public-data'
import { sourceBytes, SourceError } from './source-http'

export function parseTencentIndex(html: string, value: string) {
  const url = new URL(value)
  const id = /^\/Comic\/comicInfo\/id\/(\d+)$/.exec(url.pathname)?.[1]
  if (url.hostname !== 'ac.qq.com' || !id) throw new SourceError('Link Tencent inválido.')
  const anchors = DomUtils.findAll((node) => node.name === 'a' && Boolean(node.attribs.href), parseDocument(html).children)
  const entries = new Map<string, string>()
  for (const anchor of anchors) {
    const target = new URL(anchor.attribs.href, url)
    if (target.origin === url.origin && new RegExp(`^/ComicView/index/id/${id}/cid/\\d+$`).test(target.pathname)) {
      const title = DomUtils.textContent(anchor).trim()
      if (title && !/开始阅读/.test(title)) entries.set(target.href, title)
    }
  }
  if (!entries.size) throw new SourceError('A Tencent não retornou o índice público desta obra.')
  return [...entries].map(([url, title]) => ({ url, title }))
}
export function parseLezhinIndex(html: string) {
  const scripts = DomUtils.findAll((node) => node.name === 'script', parseDocument(html).children)
  for (const script of scripts) {
    const text = DomUtils.textContent(script).trim()
    if (!text.startsWith('self.__next_f.push(')) continue
    let chunk: unknown
    try {
      chunk = JSON.parse(text.slice('self.__next_f.push('.length).replace(/\);?$/, ''))
    } catch {
      continue
    }
    if (!Array.isArray(chunk) || typeof chunk[1] !== 'string') continue
    for (const line of chunk[1].split('\n')) {
      const separator = line.indexOf(':')
      if (separator < 0) continue
      try {
        const value = JSON.parse(line.slice(separator + 1))
        const data = findData(value, (item) => Array.isArray(item.episodes) && item.content?.alias)
        if (data)
          return {
            title: data.content.alias,
            total: data.episodes.length,
            publicEpisodes: data.episodes.filter((episode: any) => episode.coin === 0 && !episode.properties?.expired).length,
          }
      } catch {
        /* Linhas RSC que não são JSON de catálogo. */
      }
    }
  }
  throw new SourceError('A Lezhin não retornou um índice público reconhecido.')
}
export async function officialIndex(provider: string, url: string, signal?: AbortSignal) {
  const html = (await sourceBytes(url, false, signal)).bytes.toString('utf8')
  if (provider === 'tencent')
    return {
      total: parseTencentIndex(html, url).length,
      message: 'Tencent: índice público consultado. As páginas ainda não têm conector de leitura.',
    }
  if (provider === 'lezhin') {
    const data = parseLezhinIndex(html)
    return {
      total: data.total,
      message: `Lezhin: ${data.total} episódios listados, ${data.publicEpisodes} marcados sem custo no índice. Coleta de páginas ainda não implementada.`,
    }
  }
  return {
    total: null,
    message: 'Vínculo público consultado. O conector de capítulos e páginas desta plataforma ainda não está implementado.',
  }
}
