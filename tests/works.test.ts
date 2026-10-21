import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../lib/backend/shared/database.module', () => ({ db: null }))
import { SQLITE_MIGRATIONS } from '../lib/backend/shared/migrations'
import { WorksRepository } from '../lib/backend/works/repository'
import { consolidateChapters, mapCatalogWork } from '../lib/backend/works/mangadex'
import { checkedSourceUrl, isPublicAddress } from '../lib/backend/works/source-http'
import { titleScore, type CatalogWork, type SourceChapter } from '../lib/works'

const ID = '11111111-1111-4111-8111-111111111111'
const work: CatalogWork = { source: 'mangadex', sourceId: ID, title: 'The Eminence in Shadow', originalTitle: 'Kage no Jitsuryokusha ni Naritakute!', aliases: [{ language: 'pt-br', title: 'Eminência nas Sombras' }, { language: 'ja', title: '陰の実力者になりたくて！' }], description: '', descriptionLanguage: 'pt-br', authors: ['Autor de teste'], genres: [], originalLanguage: 'ja', year: 2020, coverFile: null }
const chapter = (number: string): SourceChapter => ({ sourceId: ID, key: `chapter:${number}`, title: `Teste ${number}`, number, volume: '1', language: 'en', position: Number(number), pageCount: 2 })

describe('obra e atualização incremental', () => {
  let database: Database.Database; let repository: WorksRepository
  beforeEach(() => {
    database = new Database(':memory:')
    for (const migration of SQLITE_MIGRATIONS) database.exec(migration.up)
    database.prepare(`INSERT INTO users (id,name,email,password_hash,role,created_at,updated_at) VALUES (1,'Teste','test@example.invalid','hash',4,'now','now'),(2,'Outro','other@example.invalid','hash',4,'now','now')`).run()
    repository = new WorksRepository(database)
  })
  afterEach(() => database.close())
  it('adiciona a obra uma única vez e lista seus capítulos sem cadastro manual', () => {
    const id = repository.add(1, work)
    expect(repository.add(1, work)).toBe(id)
    repository.syncChapters(id, [chapter('1'), chapter('2')])
    expect(repository.detail(id, 1)?.chapters.map((c) => c.number)).toEqual(['1', '2'])
    expect(repository.list(1)[0].totalChapters).toBe(2)
  })
  it('adiciona obras de uma fonte personalizada e reutiliza vínculos da mesma obra já existente', async () => {
    const { ensureSources } = await import('../lib/backend/works/custom-sources')
    database.prepare("INSERT INTO kv_store (key,value,expires_at) VALUES ('koma:custom-sources:v1',?,NULL)").run(JSON.stringify([{ id: 'leitor', name: 'Leitor', origin: 'https://leitor.example.com', kind: 'manga' }]))
    await ensureSources(database, true)
    const direct: CatalogWork = {...work,source:'leitor',sourceId:'leitor:obra-nova'}
    const directId=repository.add(1,direct)
    expect(repository.row(directId)?.source).toBe('leitor')
    expect(database.prepare('SELECT provider,url FROM work_catalog_sources WHERE work_id=?').get(directId)).toEqual({provider:'leitor',url:'https://leitor.example.com/manga/obra-nova/'})
    const canonical=repository.add(1,{...work,sourceId:'77bee52c-d2d6-44ad-a33a-1734c1fe696a'})
    repository.bindSource(canonical,1,'https://leitor.example.com/manga/obra-antiga/')
    expect(repository.add(1,{...direct,sourceId:'leitor:obra-antiga'})).toBe(canonical)
    expect(repository.list(1)).toHaveLength(2)
    database.prepare("DELETE FROM kv_store WHERE key='koma:custom-sources:v1'").run()
    await ensureSources(database, true)
  })
  it('refresh só acrescenta capítulos novos e preserva traduções/progresso', () => {
    const id = repository.add(1, work)
    repository.syncChapters(id, [chapter('1'), chapter('2')])
    const first = repository.detail(id,1)!.chapters[0]
    repository.chapterStage(first.id, 'ready'); repository.markRead(id, first.id, 1)
    repository.control(id,1,'refresh')
    expect(repository.syncChapters(id,[chapter('1'), chapter('2'), chapter('3')])).toBe(1)
    const state = repository.detail(id,1)!
    expect(state.chapters[0]).toMatchObject({ id: first.id, state: 'ready', read: true })
    expect(state.work.totalChapters).toBe(3)
  })
  it('reposiciona capítulos descobertos depois sem perder os já lidos', () => {
    const id = repository.add(1, work)
    repository.syncChapters(id, [{...chapter('1'),position:0},{...chapter('3'),position:1}])
    const third = repository.detail(id,1)!.chapters[1]
    repository.chapterStage(third.id,'ready'); repository.markRead(id,third.id,1)
    repository.syncChapters(id,[{...chapter('1'),position:0},{...chapter('2'),position:1},{...chapter('3'),position:2}])
    const chapters=repository.detail(id,1)!.chapters
    expect(chapters.map((item)=>item.number)).toEqual(['1','2','3'])
    expect(chapters[2]).toMatchObject({id:third.id,state:'ready',read:true})
  })
  it('refresh global, favoritos, pausa e retomada respeitam o proprietário', () => {
    const id = repository.add(1,work); repository.syncChapters(id,[chapter('1')])
    expect(repository.control(id,2,'pause')).toBe(false)
    expect(repository.detail(id,2)).toBeNull()
    repository.control(id,1,'favorite',true); repository.control(id,1,'pause')
    expect(repository.nextChapter()).toBeUndefined()
    repository.control(id,1,'resume')
    expect(repository.nextChapter()?.work_id).toBe(id)
    expect(repository.list(1)[0].favorite).toBe(true)
    expect(repository.refreshAll(2)).toBe(0)
    expect(repository.refreshAll(1)).toBe(1)
  })
})

describe('identidade e origem dos resultados', () => {
  it('prioriza a obra exata sobre derivados e reconhece alias brasileiro/japonês', () => {
    const derivative = { ...work, title: 'The Eminence in Shadow: Side Story', originalTitle: 'Side Story', aliases: [] }
    expect(titleScore(work,'Eminence in Shadow')).toBeGreaterThan(titleScore(derivative,'Eminence in Shadow'))
    expect(titleScore(work,'eminencia nas sombras')).toBe(1000)
    expect(titleScore(work,'陰の実力者になりたくて！')).toBe(1000)
  })
  it('consolida versões de um capítulo, sem somar grupos/idiomas como capítulos diferentes', () => {
    const record = (id: string, language: string, number: string) => ({ id, attributes: { chapter: number, volume:'1', title:'', translatedLanguage: language, pages:20, externalUrl:null } })
    const result = consolidateChapters([record(ID,'en','1'),record('22222222-2222-4222-8222-222222222222','pt-br','1'),record(ID,'en','2')])
    expect(result).toHaveLength(2); expect(result[0].language).toBe('pt-br')
    expect(consolidateChapters([{ ...record(ID,'en','3'), attributes: { ...record(ID,'en','3').attributes, externalUrl:'https://example.invalid' } }])).toHaveLength(0)
  })
  it('preserva capítulos com sufixos distintos e numeração reiniciada por volume', () => {
    const record = (number: string, volume: string) => ({ id: ID, attributes: { chapter: number, volume, translatedLanguage: 'en', pages: 2 } })
    const result = consolidateChapters([record('1.10','1'), record('1.1','1'), record('1','1'), record('01','1'), record('1','2')])
    expect(result).toHaveLength(4)
    expect(new Set(result.map((item) => item.key)).size).toBe(4)
    expect(result.at(-1)?.volume).toBe('2')
    expect(result.map((item) => item.position)).toEqual([0,1,2,3])
  })
  it('mapeia metadados reais sem aceitar capas arbitrárias', () => {
    const mapped = mapCatalogWork({ id:ID,attributes:{ title:{ 'ja-ro':'Original' },altTitles:[{en:'English'},{'pt-br':'Nome brasileiro'}],description:{en:'<script>example</script> Text'},originalLanguage:'ja',tags:[] },relationships:[{ type:'cover_art',id:ID,attributes:{fileName:'../../secret'} }] })
    expect(mapped.title).toBe('Nome brasileiro'); expect(mapped.coverFile).toBeNull(); expect(mapped.description).not.toContain('<script>')
  })
  it('bloqueia destinos privados, esquemas inseguros e redirecionamento para outros serviços', () => {
    for (const value of ['http://api.mangadex.org','https://127.0.0.1','https://api.mangadex.org.evil.invalid','https://secret@uploads.mangadex.org','https://uploads.mangadex.org:444']) expect(() => checkedSourceUrl(value)).toThrow()
    for (const address of ['127.0.0.1','10.0.0.1','192.168.1.1','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1','2001:0db8::1']) expect(isPublicAddress(address)).toBe(false)
    expect(isPublicAddress('104.21.1.1')).toBe(true)
    expect(checkedSourceUrl('https://uploads.mangadex.org/data/hash/file.png').hostname).toBe('uploads.mangadex.org')
  })
})
