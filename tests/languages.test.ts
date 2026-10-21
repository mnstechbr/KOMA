import { describe, expect, it, vi } from 'vitest'
vi.mock('../lib/backend/shared/database.module', () => ({ db: null }))
import { sameLanguage, targetInfo } from '../lib/languages'
import { versionRank } from '../lib/backend/works/aggregators'
import { requestBody } from '../lib/backend/kpassword/translation'
import { defaultTranslationSettings } from '../lib/backend/kpassword/settings'

describe('idioma de tradução por obra', () => {
  it('reconhece capítulos já no idioma de destino', () => {
    expect(sameLanguage('pt-br', 'pt-br')).toBe(true)
    expect(sameLanguage('pt', 'pt-br')).toBe(false)
    expect(sameLanguage('es-la', 'es')).toBe(true)
    expect(sameLanguage('en', 'es')).toBe(false)
    expect(targetInfo('PT').code).toBe('pt-br')
  })
  it('prioriza versões no idioma de destino da obra', () => {
    const es = { sourceId: 'mangadex:1', language: 'es-la' }
    const en = { sourceId: 'mangadex:2', language: 'en' }
    expect(versionRank(es, 'es')).toBeLessThan(versionRank(en, 'es'))
    expect(versionRank(en, 'en')).toBeLessThan(versionRank(es, 'en'))
  })
  it('pede ao modelo o idioma de destino certo', () => {
    const profile = { provider: 'deepseek' as const, model: 'deepseek-v4-flash', credentialId: '' }
    const pt = JSON.stringify(requestBody(profile, false, 'en', defaultTranslationSettings(), 1000, '{}'))
    const es = JSON.stringify(requestBody(profile, false, 'en', defaultTranslationSettings(), 1000, '{}', 'es'))
    expect(pt).toContain('português brasileiro')
    expect(es).toContain('Spanish')
    expect(es).not.toContain('português')
  })
})
