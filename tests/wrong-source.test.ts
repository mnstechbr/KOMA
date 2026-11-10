import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../lib/backend/shared/database.module', () => ({ db: null }))
import { SQLITE_MIGRATIONS } from '../lib/backend/shared/migrations'
import { WorksRepository } from '../lib/backend/works/repository'
import type { CatalogWork, SourceChapter } from '../lib/works'

// A obra certa tem 3 capítulos num site; outro site, ligado por engano pelo nome,
// lista 5 capítulos de outra obra de mesmo nome.
const RIGHT = 'https://certo.example/manga/the-demon-god/'
const WRONG = 'https://errado.example/manga/demon-god/'
const version = (site: string, number: string): SourceChapter => ({
  sourceId: `${site}chapter-${number}/`,
  key: `chapter:${number}`,
  title: '',
  number,
  volume: null,
  language: 'en',
  position: Number(number),
  pageCount: 0,
})
const work: CatalogWork = {
  source: 'mangadex',
  sourceId: '11111111-1111-4111-8111-111111111111',
  title: 'The Demon God',
  originalTitle: 'The Demon God',
  aliases: [],
  description: '',
  descriptionLanguage: 'en',
  authors: [],
  genres: [],
  originalLanguage: 'ko',
  year: null,
  coverFile: null,
}

describe('site ligado que era outra obra', () => {
  let database: Database.Database
  let repository: WorksRepository
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

  it('tira o vínculo, as versões e os capítulos que só ele trazia, inclusive baixados', () => {
    const id = repository.add(1, work)
    database.prepare('INSERT INTO work_catalog_sources(work_id,provider,url) VALUES(?,?,?)').run(id, 'errado', WRONG)
    const chapters = ['1', '2', '3', '4', '5'].map((number) => {
      const right = Number(number) <= 3 ? [version(RIGHT, number)] : []
      const [primary, ...alternatives] = [...right, version(WRONG, number)]
      return { ...primary, alternatives }
    })
    // O capítulo 2 tinha sido baixado do site errado.
    chapters[1] = { ...version(WRONG, '2'), alternatives: [version(RIGHT, '2')] }
    repository.syncChapters(id, chapters)
    for (const [sectionId, number] of [
      [7, '2'],
      [8, '4'],
    ] as const) {
      database.prepare(`INSERT INTO sections (id,user_id,name,created_at,updated_at) VALUES (?,1,'Cap',?,?)`).run(sectionId, 'now', 'now')
      database.prepare("UPDATE work_chapters SET state='ready',section_id=? WHERE work_id=? AND number=?").run(sectionId, id, number)
    }
    const ids = new Set(['1', '2', '3', '4', '5'].map((number) => version(WRONG, number).sourceId))
    expect(repository.dropWrongSource(id, WRONG, ids).sort()).toEqual([7, 8])

    const left = database.prepare('SELECT number,source_id,state,section_id FROM work_chapters WHERE work_id=? ORDER BY position').all(id)
    expect(left).toEqual([
      { number: '1', source_id: `${RIGHT}chapter-1/`, state: 'queued', section_id: null },
      { number: '2', source_id: `${RIGHT}chapter-2/`, state: 'queued', section_id: null },
      { number: '3', source_id: `${RIGHT}chapter-3/`, state: 'queued', section_id: null },
    ])
    expect(database.prepare("SELECT count(*) AS n FROM work_source_versions WHERE source_id LIKE 'https://errado%'").get()).toEqual({
      n: 0,
    })
    expect(database.prepare('SELECT count(*) AS n FROM work_catalog_sources WHERE url=?').get(WRONG)).toEqual({ n: 0 })
    expect(database.prepare('SELECT count(*) AS n FROM sections').get()).toEqual({ n: 0 })
  })

  it('site escolhido pela pessoa fica marcado como conferido e não aparece na lista de fontes', () => {
    const id = repository.add(1, work)
    repository.bindSource(id, 1, 'https://comic.naver.com/webtoon/list?titleId=123')
    expect(database.prepare("SELECT status FROM work_source_checks WHERE work_id=? AND kind='identity'").get(id)).toEqual({
      status: 'same',
    })
    expect(repository.detail(id, 1)!.sources).toEqual([])
  })
})
