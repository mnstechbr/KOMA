import { vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('../lib/backend/shared/database.module', () => ({ db: {} }))
import { describe, expect, it } from 'vitest'
import { deeplSource, deeplTarget, deeplUsage, runDeeplFree } from '../lib/backend/kpassword/deepl-free'
import { normalizeReply, readSceneReply } from '../lib/backend/kpassword/translation'
import { parseTranslationSettings, defaultTranslationSettings } from '../lib/backend/kpassword/settings'

const body = (lines: Array<{ id: number; text: string }>) => ({ messages: [{ content: JSON.stringify({ contextOnly: [], lines }) }] })

describe('DeepL API Free', () => {
  it('manda as falas em lotes e usa os códigos de idioma do DeepL', async () => {
    const seen: Array<{ url: string; auth: string; payload: { text: string[]; target_lang: string; source_lang?: string } }> = []
    const fetcher = (async (url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body))
      seen.push({ url, auth: String((init?.headers as Record<string, string>).Authorization), payload })
      return new Response(JSON.stringify({ translations: payload.text.map((text: string) => ({ text: `PT:${text}` })) }), { status: 200 })
    }) as unknown as typeof fetch
    const lines = Array.from({ length: 60 }, (_, id) => ({ id, text: `LINE ${id}` }))
    const reply = readSceneReply(normalizeReply(await runDeeplFree(body(lines), 'en', 'pt-br', fetcher, [0], 'key:fx')), lines.map((line) => line.id))
    expect(seen).toHaveLength(2)
    expect(seen[0]).toMatchObject({ url: 'https://api-free.deepl.com/v2/translate', auth: 'DeepL-Auth-Key key:fx', payload: { target_lang: 'PT-BR', source_lang: 'EN' } })
    expect(reply.lines[59].text).toBe('PT:Line 59')
  })
  it('franquia esgotada vira espera, chave recusada vira erro de credencial, sem revisão', async () => {
    const status = (code: number) => (async () => new Response('', { status: code })) as unknown as typeof fetch
    await expect(runDeeplFree(body([{ id: 0, text: 'HI' }]), 'en', 'pt-br', status(456), [0], 'k:fx')).rejects.toMatchObject({ code: 'quota_exceeded' })
    await expect(runDeeplFree(body([{ id: 0, text: 'HI' }]), 'en', 'pt-br', status(403), [0], 'k:fx')).rejects.toMatchObject({ code: 'invalid_credentials' })
    await expect(runDeeplFree({ messages: [{ content: JSON.stringify({ lines: [{ id: 0, text: 'A' }], proposal: [] }) }] }, 'en', 'pt-br', status(200), [0], 'k:fx')).rejects.toMatchObject({ code: 'unsupported_operation' })
    expect(deeplTarget('en')).toBe('EN-US'); expect(deeplTarget('es')).toBe('ES'); expect(deeplSource('auto')).toBeUndefined(); expect(deeplSource('ko')).toBe('KO')
  })
  it('lê o consumo da franquia', async () => {
    const fetcher = (async () => new Response(JSON.stringify({ character_count: 1200, character_limit: 500000 }), { status: 200 })) as unknown as typeof fetch
    expect(await deeplUsage('k:fx', fetcher)).toEqual({ used: 1200, limit: 500000 })
  })
  it('tradutor grátis trabalha sem revisor', () => {
    const settings = { ...defaultTranslationSettings(), enabled: true, translation: { provider: 'deepl-free' as const, model: 'deepl-free', credentialId: '' }, review: { enabled: true, provider: 'mimo' as const, model: 'mimo-v2.6-flash', credentialId: '' } }
    settings.consent = { ...settings.consent, 'deepl-free': true, mimo: true }
    expect(() => parseTranslationSettings(settings)).toThrow('sem revisão')
    expect(parseTranslationSettings({ ...settings, review: { ...settings.review, enabled: false } }).translation.provider).toBe('deepl-free')
  })
})
