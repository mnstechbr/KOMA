import { describe, it, expect, beforeAll } from 'vitest'
import { parseDocument } from 'htmlparser2'
import Database from 'better-sqlite3'
import { madara } from '../lib/backend/works/aggregator-kit'
import { baseDomain, ensureSources, listCustomSources, sourceFromWorkUrl, catalogFor } from '../lib/backend/works/custom-sources'
import { aggregators, aggregatorFor } from '../lib/backend/works/aggregators'
import { registerSourceHosts, checkedSourceUrl } from '../lib/backend/works/source-http'

const origin = 'https://leitor.example.com'
const url = `${origin}/manga/obra/`
const site = madara({ id: 'leitor', name: 'Leitor', origin, kind: 'manga', imageHost: (host) => host === 'img.leitor.example.com' })
const doc = (html: string) => parseDocument(html)
beforeAll(() =>
  registerSourceHosts('teste:leitor', { allows: (host) => host === 'leitor.example.com' || host.endsWith('.leitor.example.com') }),
)

describe('modelo Madara para fontes personalizadas', () => {
  it('lê somente os links de capítulo da mesma obra e conserva partes', () => {
    const html = `<a href="${url}chapter-999/">anúncio</a><ul><li class="wp-manga-chapter"><a href="${url}chapter-1/">Chapter 1</a></li><li class="wp-manga-chapter"><a href="${url}chapter-1-5/">Chapter 1.5</a></li><li class="wp-manga-chapter"><a href="${origin}/manga/outra/chapter-2/">Outra</a></li></ul>`
    expect(site.parseChapters(doc(html), url).map((c) => c.number)).toEqual(['1', '1.5'])
  })
  it('não confunde capa, comentários e banner isolado com páginas da história', () => {
    const image = `${origin}/wp-content/uploads/WP-manga/data/manga_1/hash/1.jpg`
    const html = `<img src="https://evil.invalid/cover.jpg"><div class="reading-content"><img class="wp-manga-chapter-img" data-src="\n${image}\n"><img class="wp-manga-chapter-img" src="${image.replace('1.jpg', '2.jpg')}"><img class="wp-manga-chapter-img" src="https://img.leitor.example.com/3.jpg"></div><img class="wp-manga-chapter-img" src="https://evil.invalid/comment.jpg">`
    expect(site.parsePages(doc(html), `${url}chapter-1/`)).toHaveLength(3)
    expect(() =>
      site.parsePages(
        doc(
          `<div class="reading-content"><img class="wp-manga-chapter-img" src="${image}"><img class="wp-manga-chapter-img" src="${image.replace('1.jpg', 'banner.png')}"></div>`,
        ),
        `${url}chapter-1/`,
      ),
    ).toThrow('apenas créditos')
    expect(() => site.parsePages(doc(html.replace(image, 'https://evil.invalid/page.jpg')), `${url}chapter-1/`)).toThrow()
    expect(() => site.parsePages(doc('<main>sem leitor</main>'), `${url}chapter-1/`)).toThrow('não disponibilizou')
  })
  it('extrai identidade, capa e aliases da busca e reconhece busca sem resultado', () => {
    const entry = `<div class="row c-tabs-item__content"><div class="tab-thumb"><img src="${origin}/wp-content/uploads/cover.jpg"></div><div class="post-title"><h3><a href="${url}">Obra &amp; título</a></h3></div><div class="mg_alternative"><div class="summary-content">Outro nome;別名</div></div></div>`
    const results = site.parseSearch(doc(`<a href="${origin}/manga/anuncio/">anúncio</a>${entry}`))
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      source: 'leitor',
      sourceName: 'Leitor',
      sourceId: 'leitor:obra',
      title: 'Obra & título',
      aliases: [
        { language: 'und', title: 'Outro nome' },
        { language: 'und', title: '別名' },
      ],
    })
    expect(site.parseSearch(doc(entry.replace(url, 'https://evil.invalid/manga/obra/')))).toEqual([])
    expect(
      site.parseSearch(doc(entry.replace(`${origin}/wp-content/uploads/cover.jpg`, 'https://evil.invalid/ad.jpg')))[0].coverFile,
    ).toBeNull()
    expect(site.parseSearch(doc('<main>No results found</main>'))).toEqual([])
    expect(() => site.parseSearch(doc('<main>Verifique seu navegador</main>'))).toThrow('busca válida')
  })
})

describe('cadastro de fontes personalizadas', () => {
  it('monta a fonte pelo link de uma obra sem aceitar endereços estranhos', () => {
    expect(sourceFromWorkUrl('https://www.leitor.example.com/manga/obra-x/?x=1')).toEqual({
      source: { id: 'leitor', name: 'leitor.example.com', origin: 'https://www.leitor.example.com', kind: 'manga' },
      workUrl: 'https://www.leitor.example.com/manga/obra-x/',
    })
    expect(sourceFromWorkUrl('https://leitor.example.com/manga/obra/', ['leitor']).source.id).toBe('leitor-2')
    expect(sourceFromWorkUrl('https://mangadex.example/series/obra/').source.id).toBe('mangadex-site')
    for (const value of [
      'http://leitor.example.com/manga/obra/',
      'https://leitor.example.com/manga/',
      'https://u:p@leitor.example.com/manga/obra/',
      'nada',
    ])
      expect(() => sourceFromWorkUrl(value)).toThrow()
  })
  it('aceita imagens do mesmo site em subdomínios', () => {
    expect(baseDomain('c3.leitor.com')).toBe('leitor.com')
    expect(baseDomain('img.leitor.com.br')).toBe('leitor.com.br')
  })
  it('liga as fontes salvas ao app: busca, capítulos e servidores liberados', async () => {
    const database = new Database(':memory:')
    database.exec('CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT, expires_at INTEGER)')
    database
      .prepare('INSERT INTO kv_store VALUES (?,?,NULL)')
      .run(
        'koma:custom-sources:v1',
        JSON.stringify([{ id: 'meusite', name: 'Meu Site', origin: 'https://www.meusite.example', kind: 'series' }]),
      )
    await ensureSources(database, true)
    expect(listCustomSources(database).map((item) => item.id)).toEqual(['meusite'])
    expect(aggregators[0].id).toBe('webtoons')
    expect(aggregatorFor('https://www.meusite.example/series/obra/chapter-3/')?.id).toBe('meusite')
    expect(catalogFor('meusite:obra')?.workUrl('obra')).toBe('https://www.meusite.example/series/obra/')
    expect(checkedSourceUrl('https://c2.meusite.example/1.jpg').hostname).toBe('c2.meusite.example')
    database.prepare('UPDATE kv_store SET value=? WHERE key=?').run('[]', 'koma:custom-sources:v1')
    await ensureSources(database, true)
    expect(aggregatorFor('https://www.meusite.example/series/obra/chapter-3/')).toBeUndefined()
    expect(() => checkedSourceUrl('https://c2.meusite.example/1.jpg')).toThrow()
  })
})
