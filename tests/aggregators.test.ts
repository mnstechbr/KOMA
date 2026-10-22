import { beforeEach, describe, expect, it, vi } from 'vitest'
const { pages } = vi.hoisted(() => ({ pages: new Map<string, string>() }))
vi.mock('server-only', () => ({}))
vi.mock('../lib/backend/works/source-http', async (original) => {
  const actual = await original<typeof import('../lib/backend/works/source-http')>()
  return { ...actual, sourceBytes: vi.fn(async (url: string) => {
    const body = pages.get(url)
    if (body === undefined) throw new actual.SourceError(`sem fixture: ${url}`)
    return { bytes: Buffer.from(body), mime: 'text/html' }
  }) }
})
import { aggregators, matchingResult, searchTitles, sourceRank, versionRank } from '../lib/backend/works/aggregators'
import { mergeChapterSources } from '../lib/backend/works/chapter-sources'

const connector = (id: string) => aggregators.find((item) => item.id === id)!
beforeEach(() => pages.clear())

describe('fontes alternativas por título', () => {
  it('pesquisa pelos títulos conhecidos e só aceita correspondência exata', () => {
    const titles = searchTitles({ title: 'Crônicas da Facção Demoníaca', originalTitle: 'Mado Jeonsaenggi', aliases: [{ language: 'en', title: 'Chronicles of the Demon Faction' }, { language: 'ko', title: '마도전생기' }] })
    expect(titles).toEqual(['Crônicas da Facção Demoníaca', 'Chronicles of the Demon Faction', 'Mado Jeonsaenggi'])
    expect(matchingResult([{ title: "The Demon Faction's Return", url: 'a' }, { title: 'Chronicles of the Demon Faction', url: 'b' }], titles)?.url).toBe('b')
    expect(matchingResult([{ title: 'Chronicles of the Demon Faction Return', url: 'a' }], titles)).toBeUndefined()
  })

  it('ignora o marcador de carregamento do tema Madara e bloqueia imagens de outros hosts', async () => {
    const { madara } = await import('../lib/backend/works/aggregator-kit')
    const { registerSourceHosts } = await import('../lib/backend/works/source-http')
    registerSourceHosts('teste:leitor', { allows: (host) => host.endsWith('leitor.example.com') })
    const site = madara({ id: 'leitor', name: 'Leitor', origin: 'https://leitor.example.com', kind: 'manga', imageHost: (host) => /^c\d\.leitor\.example\.com$/.test(host) }).connector
    const chapter = 'https://leitor.example.com/manga/obra/chapter-1/'
    pages.set(chapter, '<div class="reading-content"><img src="https://leitor.example.com/wp-content/themes/madara/images/loading6.svg" data-src="https://c2.leitor.example.com/manga_x/chapter_0/c_0_1.png" class="wp-manga-chapter-img"></div>')
    expect(await site.pages(chapter)).toEqual([{ name: 'page-0001.png', url: 'https://c2.leitor.example.com/manga_x/chapter_0/c_0_1.png' }])
    pages.set(chapter, '<div class="reading-content"><img data-src="https://ads.leitor.example.com/x.png" class="wp-manga-chapter-img"></div>')
    await expect(site.pages(chapter)).rejects.toMatchObject({ code: 'destination_blocked' })
  })

  it('pagina o índice oficial do WEBTOON e numera pelo título do episódio', async () => {
    const list = 'https://www.webtoons.com/en/action/chronicles-of-the-demon-faction/list?title_no=5832'
    const item = (n: number) => `<li class="_episodeItem"><a href="https://www.webtoons.com/en/action/chronicles-of-the-demon-faction/episode-${n}/viewer?title_no=5832&episode_no=${n}"><span class="subj"><span>Episode ${n}</span></span></a></li>`
    pages.set(`${list}&page=1`, item(2) + item(1)); pages.set(`${list}&page=2`, '')
    const chapters = await connector('webtoons').chapters(list)
    expect(chapters.map((chapter) => chapter.number)).toEqual(['1', '2'])
    expect(connector('webtoons').work('https://www.webtoons.com/en/canvas/fanfic/list?title_no=1')).toBe(false)
  })

  it('prefere a publicação oficial entre versões do mesmo capítulo', () => {
    expect(sourceRank('https://www.webtoons.com/en/action/x/episode-1/viewer?title_no=1&episode_no=1')).toBeLessThan(sourceRank('11111111-1111-4111-8111-111111111111'))
  })

  it('usa a fonte original primeiro, inclusive coreana, antes de PT-BR e traduções; Jump+ só como índice', () => {
    const jump = { sourceId: 'https://shonenjumpplus.com/episode/1', language: 'ja' }
    const naver = { sourceId: 'https://comic.naver.com/webtoon/detail?titleId=1&no=1', language: 'ko' }
    const ptbr = { sourceId: '11111111-1111-4111-8111-111111111111', language: 'pt-br' }
    const official = { sourceId: 'https://www.webtoons.com/en/action/x/episode-1/viewer?title_no=1&episode_no=1', language: 'en' }
    const scan = { sourceId: 'https://leitor.example.com/manga/x/chapter-1/', language: 'en' }
    const ranked = [scan, naver, official, ptbr, jump].sort((a, b) => versionRank(a) - versionRank(b))
    expect(ranked).toEqual([naver, ptbr, official, scan, jump])
  })

  it('escolhe a versão principal de cada capítulo pela prioridade de fontes', () => {
    const base = { key: 'chapter:1', number: '1', volume: null, title: '', position: 0, pageCount: 0 }
    const merged = mergeChapterSources([
      [{ ...base, sourceId: '11111111-1111-4111-8111-111111111111', key: 'chapter:1:volume:1', volume: '1', language: 'en' }],
      [{ ...base, sourceId: 'https://www.webtoons.com/en/action/x/episode-1/viewer?title_no=1&episode_no=1', language: 'en' }],
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].sourceId).toContain('webtoons.com')
    expect(merged[0].key).toBe('chapter:1:volume:1')
    expect(merged[0].alternatives?.map((item) => item.sourceId)).toEqual(['11111111-1111-4111-8111-111111111111'])
  })
})
