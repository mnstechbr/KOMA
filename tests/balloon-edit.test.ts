import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { changedTerm, rememberCorrection, workGlossary } from '../lib/backend/works/names'

describe('correções do editor de balões', () => {
  it('acha o termo trocado quando a correção é curta', () => {
    expect(changedTerm('A Phoenix voltou!', 'A Fênix voltou!')).toEqual({ before: 'phoenix', after: 'Fênix' })
    expect(changedTerm('Vamos, Senhor Demônio.', 'Vamos, Lorde Demônio.')).toEqual({ before: 'senhor', after: 'Lorde' })
    expect(changedTerm('Eu não sei o que dizer agora.', 'Não faço ideia do que falar neste momento, sinceramente.')).toBeNull()
    expect(changedTerm('Olá.', 'Olá!')).toBeNull()
    expect(changedTerm('O BOMBARDEIO TÁ CAINDO!!', 'O BOMBARDEIO ESTÁ CAINDO!!')).toEqual({ before: 'tá', after: 'está' })
  })
  it('guarda a correção no glossário da obra para os próximos capítulos', () => {
    const database = new Database(':memory:')
    database.exec('CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT, expires_at INTEGER)')
    rememberCorrection(database, 7, 'THE PHOENIX IS BACK!', 'A Phoenix voltou!', 'A Fênix voltou!')
    const glossary = workGlossary(database, 7)
    expect(glossary).toContain('"Fênix" em vez de "phoenix"')
    expect(glossary).toContain('"THE PHOENIX IS BACK!" → "A Fênix voltou!"')
    expect(workGlossary(database, 8)).toBe('')
  })
})
