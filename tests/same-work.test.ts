import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { findOnAggregator, searchTitles, titleMatch, type AggregatorConnector } from '../lib/backend/works/aggregators'
import { sameWork, synopsisNames, workOrigin } from '../lib/backend/works/same-work'

// Sinopses reais (resumidas) de duas obras diferentes com quase o mesmo nome.
const demonGod = {
  title: 'The Demon God',
  originalLanguage: 'und',
  genres: [],
  description:
    'A brief description of the manhwa The Demon God: A hundred children were trapped on Hengshan. Only one walked out alive, a boy named Dan Hyeongwoo. He survived the hell created by the Cheon Gija. [By the Author that brought you <The Heavenly Demon Wants a Quiet Life>!]',
}
const otherDemonGod = {
  title: 'Demon God',
  originalLanguage: 'zh',
  genres: ['Action'],
  description:
    'Thousands of years ago, the immortal clan and demon clan were battling for the universe. And Lu Xiaofei inherit a piece of the fighter.',
}

describe('mesma obra em outro site', () => {
  it('distingue o nome idêntico do que só bate sem o "The"', () => {
    expect(titleMatch('Demon God', ['The Demon God'])).toBe('article')
    expect(titleMatch('the demon-god!', ['The Demon God'])).toBe('exact')
    expect(titleMatch('Demon God Returns', ['The Demon God'])).toBeNull()
  })

  it('tira a origem de "manhwa"/"manhua" quando o site não informa o idioma', () => {
    expect(workOrigin(demonGod)).toBe('ko')
    expect(workOrigin({ genres: ['Manhua', 'Action'] })).toBe('zh')
    expect(workOrigin({ genres: ['Manga'] })).toBeNull()
  })

  it('lê nomes da sinopse sem as palavras do título e sem a propaganda entre colchetes', () => {
    const names = synopsisNames(demonGod)
    expect([...names]).toEqual(expect.arrayContaining(['hengshan', 'dan', 'hyeongwoo', 'gija']))
    expect(names.has('heavenly')).toBe(false)
    expect(names.has('demon')).toBe(false)
  })

  it('recusa a outra obra de mesmo nome (origem e personagens diferentes)', () => {
    expect(sameWork(demonGod, otherDemonGod, 'article')).toBe(false)
    expect(sameWork(demonGod, otherDemonGod, 'exact')).toBe(false)
  })

  it('não recusa a mesma obra quando um site erra o gênero ou escreve a sinopse de outro jeito', () => {
    const heavenly = { title: 'Heavenly Martial God', originalLanguage: 'ko', description: 'Namgoong Hyuk, the Matchless Sword.' }
    // Site que marcou como manhua uma obra coreana: os personagens coincidem.
    expect(sameWork(heavenly, { title: 'Heavenly Martial God', genres: ['Manhua'], description: 'Namgoong Hyuk returns.' }, 'exact')).toBe(
      true,
    )
    // Sinopse em português de um lado, nomes romanizados de outro jeito: nome idêntico basta.
    const pt = { title: 'Divine Demon', originalLanguage: 'ko', description: 'Ele domina o Caminho Demoníaco e as Seitas Demoníacas.' }
    expect(sameWork(pt, { title: 'Divine Demon', genres: ['Manhwa'], description: 'Eunseol enters the Studio of Shadows.' }, 'exact')).toBe(
      true,
    )
  })

  it('aceita o nome sem o "The" só com um sinal a favor', () => {
    const work = { ...demonGod }
    expect(sameWork(work, { title: 'Demon God', genres: ['Manhwa'] }, 'article')).toBe(true)
    expect(sameWork(work, { title: 'Demon God', description: 'Dan Hyeongwoo walks out of Hengshan alone.' }, 'article')).toBe(true)
    expect(sameWork(work, { title: 'Demon God' }, 'article')).toBe(false)
  })

  it('a pesquisa num site pula o resultado que é outra obra', async () => {
    const connector = {
      id: 'teste',
      name: 'Teste',
      official: false,
      work: () => true,
      owns: () => false,
      search: async () => [
        { title: 'Demon God', url: 'https://teste.example/manga/demon-god/' },
        { title: 'The Demon God', url: 'https://teste.example/manga/the-demon-god/' },
      ],
      chapters: async () => [],
      pages: async () => [],
      about: async (url: string) => (url.endsWith('/demon-god/') ? otherDemonGod : demonGod),
    } satisfies AggregatorConnector
    const titles = searchTitles(demonGod)
    expect((await findOnAggregator(connector, titles))?.url).toBe('https://teste.example/manga/demon-god/')
    expect((await findOnAggregator(connector, titles, undefined, demonGod))?.url).toBe('https://teste.example/manga/the-demon-god/')
  })
})
