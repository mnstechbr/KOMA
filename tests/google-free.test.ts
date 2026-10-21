import { vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { describe, expect, it } from 'vitest'
import { runGoogleFree, translateLineWithGoogle } from '../lib/backend/kpassword/google-free'
import { normalizeReply, readSceneReply } from '../lib/backend/kpassword/translation'

// Formato do Google: várias falas no corpo (q=...&q=...), uma tradução por fala na resposta.
const fakeGoogle = (async (_url: string, init?: RequestInit) => {
  const lines = new URLSearchParams(String(init?.body || '')).getAll('q')
  return new Response(JSON.stringify(lines.map((line) => `PT:${line}`)), { status: 200 })
}) as unknown as typeof fetch

describe('Google Tradutor grátis', () => {
  it('junta as linhas do balão e usa o código de idioma do Google', async () => {
    let seen = ''; let sent = ''
    const fetcher = (async (url: string, init?: RequestInit) => { seen = url; sent = String(init?.body); return new Response(JSON.stringify(['Olá']), { status: 200 }) }) as unknown as typeof fetch
    expect(await translateLineWithGoogle('WE DID\nIT!', 'en', 'pt-br', fetcher)).toBe('Olá')
    expect(new URLSearchParams(sent).getAll('q')).toEqual(['We did it!'])
    expect(new URL(seen).searchParams.get('tl')).toBe('pt')
  })

  it('responde no formato que a validação dos modelos aceita', async () => {
    const body = { messages: [{ content: JSON.stringify({ contextOnly: [], lines: [{ id: 4, text: 'HELLO' }, { id: 5, text: 'BYE' }] }) }] }
    let calls = 0
    const counting = (async (url: string, init?: RequestInit) => { calls++; return fakeGoogle(url, init) }) as unknown as typeof fetch
    const reply = readSceneReply(normalizeReply(await runGoogleFree(body, 'en', 'pt-br', counting)), [4, 5])
    expect(calls).toBe(1)
    expect(reply.lines.map((line) => line.text)).toEqual(['PT:Hello', 'PT:Bye'])
  })

  it('manda um capítulo inteiro em poucos pedidos', async () => {
    const lines = Array.from({ length: 150 }, (_, id) => ({ id, text: `LINE ${id} OF A LONG CHAPTER, WITH SOME WORDS.` }))
    const body = { messages: [{ content: JSON.stringify({ contextOnly: [], lines }) }] }
    let calls = 0
    const counting = (async (url: string, init?: RequestInit) => { calls++; return fakeGoogle(url, init) }) as unknown as typeof fetch
    const reply = readSceneReply(normalizeReply(await runGoogleFree(body, 'en', 'pt-br', counting)), lines.map((line) => line.id))
    expect(calls).toBe(2)
    expect(reply.lines[149].text).toBe('PT:Line 149 of a long chapter, with some words.')
  })

  it('não serve como revisor', async () => {
    const body = { messages: [{ content: JSON.stringify({ lines: [{ id: 0, text: 'A' }], proposal: [{ id: 0, text: 'B' }] }) }] }
    await expect(runGoogleFree(body, 'en', 'pt-br', fakeGoogle)).rejects.toMatchObject({ code: 'unsupported_operation' })
  })
})

describe('caixa do texto enviado ao Google', () => {
  it('passa maiúsculas e caixa misturada do OCR para caixa normal', async () => {
    const { sentenceCase } = await import('../lib/backend/kpassword/google-free')
    expect(sentenceCase('troUBlEsoME. Most troublesome.')).toBe('Troublesome. Most troublesome.')
    expect(sentenceCase('I BEG YOU... PLEASE!')).toBe('I beg you... Please!')
    expect(sentenceCase('Hello there.')).toBe('Hello there.')
  })
})

describe('limites do serviço do Google', () => {
  it('tenta de novo depois de um erro 500', async () => {
    let calls = 0
    const flaky = (async () => { calls++; return calls === 1 ? new Response('', { status: 500 }) : new Response(JSON.stringify(['Oi']), { status: 200 }) }) as unknown as typeof fetch
    expect(await translateLineWithGoogle('Hi', 'en', 'pt-br', flaky, [0, 0])).toBe('Oi')
    expect(calls).toBe(2)
  })
})

