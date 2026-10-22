import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { SQLITE_MIGRATIONS } from '../lib/backend/shared/migrations'
vi.mock('../lib/backend/shared/database.module', () => ({ db: null }))
import { localizeMetadata, localizeNextWork, needsLocalization } from '../lib/backend/works/synopsis'
import type { CatalogWork } from '../lib/works'

const work = (extra: Partial<CatalogWork> = {}): CatalogWork => ({
  source: 'mangadex',
  sourceId: 'mangadex:x',
  title: 'T',
  originalTitle: 'T',
  aliases: [],
  description: 'A hero returns.\n\nHe wants revenge.',
  descriptionLanguage: 'en',
  originalLanguage: 'ko',
  authors: [],
  genres: ['Action', 'Drama'],
  year: null,
  coverFile: null,
  ...extra,
})

describe('sinopse no idioma da interface', () => {
  it('usa a versão da própria fonte quando existe', () => {
    const shown = localizeMetadata(work({ descriptions: { en: 'A hero returns.', 'pt-br': 'Um herói volta.' } }), 'pt-BR')
    expect(shown.description).toBe('Um herói volta.')
    expect(needsLocalization(work(), 'en')).toBe(false)
    expect(needsLocalization(work(), 'pt-BR')).toBe(true)
  })
  it('traduz uma vez, guarda na obra e mantém os parágrafos', async () => {
    const db = new Database(':memory:')
    for (const migration of SQLITE_MIGRATIONS) db.exec(migration.up)
    db.prepare(`INSERT INTO users (id,name,email,password_hash,created_at,updated_at) VALUES (1,'L','l@x.invalid','x','d','d')`).run()
    db.prepare(
      `INSERT INTO works (id,user_id,source,source_id,title,metadata_json,created_at,updated_at) VALUES (1,1,'mangadex','x','T',?,'d','d')`,
    ).run(JSON.stringify(work()))
    const translate = vi.fn(async (texts: string[]) => ({ translations: texts.map((text) => `PT:${text}`) }))
    expect(await localizeNextWork(db, 'pt-BR', translate)).toBe(1)
    expect(translate).toHaveBeenCalledWith(['A hero returns.', 'He wants revenge.', 'Action', 'Drama'], 'en', 'pt-br')
    const saved = JSON.parse(
      (db.prepare('SELECT metadata_json FROM works WHERE id=1').get() as { metadata_json: string }).metadata_json,
    ) as CatalogWork
    expect(localizeMetadata(saved, 'pt-BR')).toMatchObject({
      description: 'PT:A hero returns.\n\nPT:He wants revenge.',
      genres: ['PT:Action', 'PT:Drama'],
    })
    expect(await localizeNextWork(db, 'pt-BR', translate)).toBeNull()
    expect(localizeMetadata(saved, 'en').description).toBe('A hero returns.\n\nHe wants revenge.')
  })
})
