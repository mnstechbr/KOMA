import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../lib/backend/shared/database.module', () => ({ db: null }))
import { SQLITE_MIGRATIONS } from '../lib/backend/shared/migrations'
import { WorksRepository } from '../lib/backend/works/repository'
import { phantomChapters, sourceHost } from '../lib/backend/works/phantom-chapters'
import { workInQueue, workPendingChapters, workPreparing, type CatalogWork, type SourceChapter } from '../lib/works'

// Fontes fictícias: a editora e três agregadores.
const SITES = ['https://editora.example/obra', 'https://um.example/obra', 'https://dois.example/obra', 'https://tres.example/obra']
const version = (site: string, number: string) => ({ key: `chapter:${number}`, sourceId: `${site}/c${number}`, number })
const run = (from: number, to: number, sites = SITES) =>
  sites.flatMap((site) => Array.from({ length: to - from + 1 }, (_, i) => version(site, String(from + i))))

describe('capítulos fantasma', () => {
  it('82.5 e 82.8 listados só por um agregador, com as outras fontes indo do 82 ao 83', () => {
    const versions = [...run(1, 144), version(SITES[3], '82.5'), version(SITES[3], '82.8')]
    const phantoms = phantomChapters(versions)
    expect([...phantoms.keys()].sort()).toEqual(['chapter:82.5', 'chapter:82.8'])
    expect(phantoms.get('chapter:82.5')).toBe('tres.example')
  })
  it('capítulo novo que só uma fonte publicou ainda não é fantasma', () => {
    expect(phantomChapters([...run(1, 144), version(SITES[1], '145')]).size).toBe(0)
  })
  it('prólogo antes do primeiro capítulo das outras fontes não é fantasma', () => {
    expect(phantomChapters([...run(1, 20), version(SITES[2], '0')]).size).toBe(0)
  })
  it('precisa de duas outras fontes pulando: uma só pode ser falha dela', () => {
    const versions = [...run(1, 10, SITES.slice(0, 2)), version(SITES[1], '5.5')]
    expect(phantomChapters(versions).size).toBe(0)
  })
  it('capítulo listado por duas fontes é real', () => {
    const versions = [...run(1, 10), version(SITES[2], '5.5'), version(SITES[3], '5.5')]
    expect(phantomChapters(versions).size).toBe(0)
  })
  it('especial sem número nunca é fantasma', () => {
    expect(phantomChapters([...run(1, 10), { key: 'special:x', sourceId: `${SITES[1]}/x`, number: null }]).size).toBe(0)
  })
  it('identifica a fonte pelo site', () => {
    expect(sourceHost('https://www.mangatown.example/manga/x/c082.5/')).toBe('mangatown.example')
    expect(sourceHost('11111111-1111-4111-8111-111111111111')).toBe('11111111-1111-4111-8111-111111111111')
  })
})

describe('capítulos fantasma na fila', () => {
  let database: Database.Database
  let repository: WorksRepository
  const work: CatalogWork = {
    source: 'mangadex',
    sourceId: '11111111-1111-4111-8111-111111111111',
    title: 'Obra de teste',
    originalTitle: 'Obra de teste',
    aliases: [],
    description: '',
    descriptionLanguage: 'pt-br',
    authors: [],
    genres: [],
    originalLanguage: 'ko',
    year: 2020,
    coverFile: null,
  }
  // Capítulo com uma versão por fonte (a primeira é a principal).
  const chapter = (number: string, sites: string[]): SourceChapter => {
    const [first, ...rest] = sites.map((site) => ({
      sourceId: `${site}/c${number}`,
      key: `chapter:${number}`,
      title: '',
      number,
      volume: null,
      language: 'en',
      position: Number(number),
      pageCount: 2,
    }))
    return { ...first, alternatives: rest }
  }
  const catalog = (extra: SourceChapter[]) => [...Array.from({ length: 10 }, (_, i) => chapter(String(i + 1), SITES)), ...extra]

  beforeEach(() => {
    database = new Database(':memory:')
    for (const migration of SQLITE_MIGRATIONS) database.exec(migration.up)
    database
      .prepare(
        `INSERT INTO users (id,name,email,password_hash,role,created_at,updated_at) VALUES (1,'Teste','test@example.invalid','hash',4,'now','now')`,
      )
      .run()
    repository = new WorksRepository(database)
  })
  afterEach(() => database.close())

  it('dispensa o fantasma, tira do total e não prende a fila', () => {
    const id = repository.add(1, work)
    repository.syncChapters(id, catalog([chapter('5.5', [SITES[3]])]))
    const ghost = repository.detail(id, 1)!.chapters.find((c) => c.number === '5.5')!
    expect(ghost).toMatchObject({ state: 'skipped', phantom: true })
    expect(ghost.message).toContain('tres.example')
    expect(repository.list(1)[0].totalChapters).toBe(10)
    database.prepare("UPDATE work_chapters SET state='ready' WHERE work_id=? AND state<>'skipped'").run(id)
    expect(repository.nextChapter()).toBeUndefined()
    expect(repository.list(1)[0]).toMatchObject({ readyChapters: 10, totalChapters: 10 })
  })

  it('obra antiga com o fantasma travado na fila é destravada ao conferir', () => {
    const id = repository.add(1, work)
    repository.syncChapters(id, catalog([chapter('5.5', [SITES[3]])]))
    // Como ficou antes desta verificação: na fila, esperando a fonte por 6 h.
    database
      .prepare(
        "UPDATE work_chapters SET state='queued',phantom=0,retry_after=?,message='Só tres.example tem este capítulo' WHERE number='5.5'",
      )
      .run(Date.now() + 6 * 3600000)
    database.prepare("UPDATE work_chapters SET state='ready' WHERE number<>'5.5'").run()
    database.prepare("UPDATE works SET stage='queued' WHERE id=?").run(id)
    expect(repository.markPhantoms(id)).toBe(1)
    expect(repository.list(1)[0]).toMatchObject({ readyChapters: 10, totalChapters: 10, stage: 'ready' })
  })

  it('volta para a fila quando outra fonte passa a listar o capítulo', () => {
    const id = repository.add(1, work)
    repository.syncChapters(id, catalog([chapter('5.5', [SITES[3]])]))
    repository.syncChapters(id, catalog([chapter('5.5', [SITES[3], SITES[0]])]))
    const back = repository.detail(id, 1)!.chapters.find((c) => c.number === '5.5')!
    expect(back).toMatchObject({ state: 'queued', phantom: false, message: '' })
    expect(repository.list(1)[0].totalChapters).toBe(11)
  })

  it('baixar mesmo assim: volta a contar e não é dispensado de novo', () => {
    const id = repository.add(1, work)
    repository.syncChapters(id, catalog([chapter('5.5', [SITES[3]])]))
    const ghost = repository.detail(id, 1)!.chapters.find((c) => c.number === '5.5')!
    expect(repository.chapterAction(id, ghost.id, 1, 'download')).toBe(true)
    repository.syncChapters(id, catalog([chapter('5.5', [SITES[3]])]))
    expect(repository.detail(id, 1)!.chapters.find((c) => c.number === '5.5')).toMatchObject({ state: 'queued', phantom: false })
    expect(repository.list(1)[0].totalChapters).toBe(11)
  })

  it('capítulo dispensado pela pessoa continua dispensado se virar fantasma', () => {
    const id = repository.add(1, work)
    repository.syncChapters(id, catalog([chapter('5.5', [SITES[3], SITES[2]])]))
    const real = repository.detail(id, 1)!.chapters.find((c) => c.number === '5.5')!
    repository.chapterAction(id, real.id, 1, 'skip')
    database.prepare("DELETE FROM work_source_versions WHERE chapter_key='chapter:5.5' AND source_id LIKE 'https://dois.example%'").run()
    repository.markPhantoms(id)
    expect(repository.detail(id, 1)!.chapters.find((c) => c.number === '5.5')).toMatchObject({
      state: 'skipped',
      phantom: true,
      message: '',
    })
  })

  describe('fila nunca presa por capítulo que não vai sair agora', () => {
    const setup = () => {
      const id = repository.add(1, work)
      repository.syncChapters(id, catalog([]))
      database.prepare("UPDATE work_chapters SET state='ready' WHERE work_id=?").run(id)
      return id
    }
    const summary = () => repository.list(1)[0]
    const set = (number: string, sql: string, ...args: unknown[]) =>
      database.prepare(`UPDATE work_chapters SET ${sql} WHERE number=?`).run(...args, number)

    it('tudo pronto: fora da fila', () => {
      setup()
      expect(summary()).toMatchObject({ totalChapters: 10, readyChapters: 10, activeChapters: 0 })
      expect(workInQueue(summary())).toBe(false)
    })
    it('capítulo dispensado (inclusive não escolhido ao adicionar) sai do total', () => {
      setup()
      set('3', "state='skipped'")
      expect(summary()).toMatchObject({ totalChapters: 9, catalogedChapters: 10, readyChapters: 9, activeChapters: 0 })
      expect(workPreparing(summary())).toBe(false)
      expect(workInQueue(summary())).toBe(false)
    })
    it('erro definitivo: pendência na obra, sem prender a fila', () => {
      const id = setup()
      set('3', "state='error',message='A fonte recusou'")
      database.prepare("UPDATE works SET stage='error' WHERE id=?").run(id)
      expect(summary()).toMatchObject({ totalChapters: 10, errorChapters: 1, activeChapters: 0 })
      expect(workInQueue(summary())).toBe(false)
      expect(workPendingChapters(summary())).toBe(1)
      // "Tentar agora" devolve à fila.
      const chapter = repository.detail(id, 1)!.chapters.find((c) => c.number === '3')!
      expect(repository.chapterAction(id, chapter.id, 1, 'retry')).toBe(true)
      expect(workInQueue(summary())).toBe(true)
    })
    it('esperando a fonte (6 h/24 h): aguardando, fora da fila até a hora', () => {
      const id = setup()
      set('3', "state='queued',retry_after=?,message='Só um site tem este capítulo'", Date.now() + 6 * 3600000)
      expect(summary()).toMatchObject({ waitingChapters: 1, activeChapters: 0 })
      expect(workInQueue(summary())).toBe(false)
      expect(repository.detail(id, 1)!.chapters.find((c) => c.number === '3')!.retryAt).toBeGreaterThan(Date.now())
      set('3', 'retry_after=?', Date.now() - 1000)
      expect(summary()).toMatchObject({ waitingChapters: 0, activeChapters: 1 })
      expect(workInQueue(summary())).toBe(true)
    })
    it('aguardando aprovação (bloqueado) continua na fila', () => {
      setup()
      set('3', "state='blocked',retry_after=?", Date.now() + 3600000)
      expect(summary()).toMatchObject({ activeChapters: 1, waitingChapters: 0 })
      expect(workInQueue(summary())).toBe(true)
    })
  })
})
