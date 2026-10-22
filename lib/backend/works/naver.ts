import { parseDocument, DomUtils } from 'htmlparser2'
import { normalizeTitle, type SourceChapter } from '@/lib/works'
import { checkedSourceUrl, sourceBytes, sourceJson, SourceError } from './source-http'

export function naverTitleId(value: string) {
  const url = checkedSourceUrl(value)
  const id = url.searchParams.get('titleId') || ''
  if (url.hostname !== 'comic.naver.com' || !/^\d{1,12}$/.test(id) || !['/webtoon/list', '/webtoon/detail'].includes(url.pathname))
    throw new SourceError('Link de publicação Naver inválido.')
  return id
}
type Article = { no: number; subtitle: string; charge: boolean }
export async function naverChapters(url: string, signal?: AbortSignal, known?: Set<string>) {
  const id = naverTitleId(url)
  const chapters = new Map<number, SourceChapter>()
  let total = 0
  let paid = 0
  for (let page = 1; page <= 1000; page++) {
    const data = await sourceJson<{ totalCount: number; articleList: Article[]; chargeFolderArticleList?: Article[] }>(
      `https://comic.naver.com/api/article/list?titleId=${id}&page=${page}`,
      signal,
    )
    if (!Array.isArray(data.articleList) || !Number.isInteger(data.totalCount))
      throw new SourceError('A Naver retornou um índice inválido.')
    total = data.totalCount
    paid = Math.max(paid, data.chargeFolderArticleList?.length || 0)
    let fresh = 0
    for (const entry of data.articleList) {
      if (!Number.isSafeInteger(entry.no) || entry.no < 1 || entry.charge !== false) continue
      const sourceId = `https://comic.naver.com/webtoon/detail?titleId=${id}&no=${entry.no}`
      if (!known?.has(sourceId)) fresh++
      chapters.set(entry.no, {
        sourceId,
        key: `chapter:${entry.no}`,
        number: String(entry.no),
        volume: null,
        title: '',
        language: 'ko',
        position: entry.no,
        pageCount: 0,
      })
    }
    if (chapters.size + paid >= total || !data.articleList.length) break
    // Do mais novo ao mais antigo: página sem episódio novo encerra a procura.
    if (known?.size && !fresh) break
    if (page === 1000) throw new SourceError('O índice da Naver ultrapassou o limite de paginação.')
  }
  return { chapters: [...chapters.values()].sort((a, b) => a.position - b.position), total, paid }
}
export function parseNaverPages(html: string, value: string) {
  const id = naverTitleId(value)
  const chapter = new URL(value).searchParams.get('no')
  if (!chapter || !/^\d+$/.test(chapter)) throw new SourceError('Capítulo Naver inválido.')
  const reader = DomUtils.findOne((node) => node.attribs.id === 'sectionContWide', parseDocument(html).children)
  if (!reader)
    throw new SourceError(
      'A Naver não disponibilizou páginas públicas deste episódio. Pode exigir compra ou autenticação.',
      false,
      'content_unavailable',
    )
  const images = DomUtils.findAll((node) => node.name === 'img' && Boolean(node.attribs.src), reader.children)
  if (!images.length || images.length > 2000) throw new SourceError('A Naver não retornou uma lista válida de páginas.')
  return images.map((image, index) => {
    const url = checkedSourceUrl(image.attribs.src.trim())
    if (
      url.hostname !== 'image-comic.pstatic.net' ||
      !url.pathname.startsWith(`/webtoon/${id}/${chapter}/`) ||
      /thumbnail/i.test(url.pathname)
    )
      throw new SourceError('A Naver retornou páginas de outro episódio.', false, 'destination_blocked')
    return { name: `page-${String(index + 1).padStart(4, '0')}.jpg`, url: url.href }
  })
}
export async function naverPages(url: string, signal?: AbortSignal) {
  return parseNaverPages((await sourceBytes(url, false, signal)).bytes.toString('utf8'), url)
}

type NaverSearchItem = { titleId?: number; contentId?: number; titleName?: string }
// Pesquisa a obra no Naver Webtoon pelos títulos em coreano. Só aceita
// correspondência exata, ignorando marcações como "[독점]".
export async function findNaverOriginal(
  metadata: { originalTitle?: string; aliases?: Array<{ language: string; title: string }> },
  signal?: AbortSignal,
) {
  const titles = [
    ...new Set(
      [
        metadata.originalTitle || '',
        ...(metadata.aliases || []).filter((alias) => alias.language === 'ko').map((alias) => alias.title),
      ].filter((title) => /[\uac00-\ud7a3]/.test(title)),
    ),
  ]
  const known = new Set(titles.map((title) => normalizeTitle(title)))
  for (const title of titles.slice(0, 3)) {
    const data = await sourceJson<{ searchWebtoonResult?: { searchViewList?: NaverSearchItem[] } }>(
      `https://comic.naver.com/api/search/all?keyword=${encodeURIComponent(title)}`,
      signal,
    )
    const match = data.searchWebtoonResult?.searchViewList?.find(
      (item) => Number.isSafeInteger(item.titleId) && known.has(normalizeTitle((item.titleName || '').replace(/\[[^\]]*\]/g, ''))),
    )
    if (match) return `https://comic.naver.com/webtoon/list?titleId=${match.titleId}`
  }
  return null
}
