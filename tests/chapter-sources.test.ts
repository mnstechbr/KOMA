import { describe, it, expect } from 'vitest'
import { parseNaverPages } from '../lib/backend/works/naver'
import { mergeChapterSources } from '../lib/backend/works/chapter-sources'
import type { SourceChapter } from '../lib/works'
import { readNuxtData } from '../lib/backend/works/public-data'
import { parseJumpPages } from '../lib/backend/works/jump-plus'
const chapter = (key: string, number: string, volume: string | null = null): SourceChapter => ({
  key,
  number,
  volume,
  sourceId: key,
  title: '',
  language: 'en',
  position: 0,
  pageCount: 0,
})
describe('consolidação entre publicações e alternativas', () => {
  it('acrescenta capítulos ausentes e mantém a identidade de capítulos salvos com volume', () => {
    const saved = chapter('chapter:1:volume:1', '1', '1')
    const result = mergeChapterSources([[chapter('chapter:1', '1'), chapter('chapter:2', '2')]], [saved])
    expect(result.map((c) => c.key)).toEqual(['chapter:1:volume:1', 'chapter:2'])
    expect(result[0].sourceId).toBe(saved.sourceId)
    expect(result[0].alternatives?.map((c) => c.sourceId)).toEqual(['chapter:1'])
    expect(mergeChapterSources([result], result)).toHaveLength(2)
  })
  it('não escolhe um volume arbitrário quando a numeração é ambígua', () => {
    const result = mergeChapterSources([[chapter('chapter:1', '1')]], [chapter('v1', '1', '1'), chapter('v2', '1', '2')])
    expect(result).toHaveLength(3)
  })
  it('a Naver só fornece imagens pertencentes ao episódio público consultado', () => {
    const chapterUrl = 'https://comic.naver.com/webtoon/detail?titleId=807777&no=187'
    const html =
      '<img src="https://image-comic.pstatic.net/webtoon/807777/1/thumbnail.jpg"><div id="sectionContWide"><img src="https://image-comic.pstatic.net/webtoon/807777/187/page.jpg"></div>'
    expect(parseNaverPages(html, chapterUrl)).toHaveLength(1)
    expect(() => parseNaverPages(html.replace('/187/page.jpg', '/186/page.jpg'), chapterUrl)).toThrow('outro episódio')
  })
  it('lê dados Nuxt sem executar funções ou acessar objetos globais', () => {
    const html = '<script>window.__NUXT__=(function(a,b){a[0]=b;return {comics:a}})(Array(1),{id:1})</script>'
    expect(readNuxtData(html).comics).toEqual([{ id: 1 }])
    expect(() => readNuxtData('<script>window.__NUXT__=process.exit()</script>')).toThrow()
    expect(() => readNuxtData('<script>window.__NUXT__=(function(a){a.constructor=1;return a})({})</script>')).toThrow()
  })
  it('obtém somente páginas públicas da mesma edição no Jump+', () => {
    const url = 'https://shonenjumpplus.com/episode/123'
    const episode = {
      permalink: url,
      series: { id: '1' },
      isPublic: true,
      pageStructure: {
        pages: [
          { type: 'main', src: 'https://cdn-ak-img.shonenjumpplus.com/public/page/1/test' },
          { type: 'ad', src: 'https://evil.invalid/ad' },
        ],
      },
    }
    const html = (value: unknown) => `<script id="episode-json" data-value='${JSON.stringify({ readableProduct: value })}'></script>`
    expect(parseJumpPages(html(episode), url)).toHaveLength(1)
    expect(() => parseJumpPages(html({ ...episode, isPublic: false }), url)).toThrow('públicas')
    // Páginas embaralhadas: o Jump+ fica só como índice, sem desembaralhar.
    expect(() => parseJumpPages(html({ ...episode, pageStructure: { ...episode.pageStructure, choJuGiga: 'baku' } }), url)).toThrow(
      'índice',
    )
  })
})
