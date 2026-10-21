import { describe, expect, it, vi } from 'vitest'
vi.mock('../lib/backend/shared/database.module', () => ({ db: null }))
import { ContextualTranslation, estimateTokens, normalizeReply, readSceneReply, requestBody } from '../lib/backend/kpassword/translation'
import { defaultTranslationSettings, parseTranslationSettings, TranslationError } from '../lib/backend/kpassword/settings'

const ID = '11111111-1111-4111-8111-111111111111'
function settings() {
  const value = defaultTranslationSettings()
  value.enabled = true
  value.translation = { provider: 'deepseek', model: 'deepseek-flash', credentialId: ID }
  value.review = { enabled: true, provider: 'mimo', model: 'mimo-test', credentialId: '22222222-2222-4222-8222-222222222222' }
  value.consent = { ...value.consent, deepseek: true, mimo: true }
  value.glossary = 'Koma é nome próprio.'
  value.voices = 'Koma: fala formal.'
  return value
}
function reply(lines: Array<{ id: number; text: string }>) {
  return { model: 'model-returned', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations: lines.map((line) => ({ ...line, needsReview: false })) }) } }], usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 } }
}

describe('adaptação contextual pelo cofre', () => {
  it('envia as falas juntas, revisa contra o original e mantém o mapeamento de balões', async () => {
    const call = vi.fn().mockResolvedValueOnce(reply([{ id: 1, text: 'Você voltou!' }, { id: 0, text: 'Conseguimos!' }])).mockResolvedValueOnce(reply([{ id: 0, text: 'A gente conseguiu!' }, { id: 1, text: 'Você voltou!' }]))
    const config = settings()
    const engine = new ContextualTranslation({ settings: () => config, call })
    const result = await engine.translate(['We did it!', 'You came back!'], 'en', 'pt-BR')
    expect(result.translations).toEqual(['A gente conseguiu!', 'Você voltou!'])
    expect(call.mock.calls[0][0].provider).toBe('deepseek')
    expect(call.mock.calls[0][1].response_format).toEqual({ type: 'json_object' })
    expect(call.mock.calls[1][0].provider).toBe('mimo')
    const first = JSON.parse(call.mock.calls[0][1].messages[1].content)
    const review = JSON.parse(call.mock.calls[1][1].messages[1].content)
    expect(first.lines).toHaveLength(2)
    expect(review.lines).toEqual(first.lines)
    expect(review.proposal[0]).toEqual({ id: 0, text: 'Conseguimos!' })
    expect(call.mock.calls[0][1].messages[0].content).toContain(config.glossary)
    expect(result.steps.map((step) => step.stage)).toEqual(['adaptation', 'review'])
    expect(result.steps[0].usage.totalTokens).toBe(50)
    expect(result.steps[0].actualModel).toBe('model-returned')
  })

  it('retoma a revisão sem repetir adaptação já concluída, inclusive em outra instância', async () => {
    const config=settings(); const cache=new Map<string,string>()
    const checkpoints={get:(key:string)=>cache.get(key),set:(key:string,value:string)=>{cache.set(key,value)}}
    const call=vi.fn().mockResolvedValueOnce(reply([{id:0,text:'Olá'}])).mockRejectedValueOnce(new TranslationError('quota_exceeded','Cota',429)).mockResolvedValueOnce(reply([{id:0,text:'Oi!'}]))
    await expect(new ContextualTranslation({settings:()=>config,call,checkpoints}).translate(['Hello'],'en','pt-BR')).rejects.toMatchObject({code:'quota_exceeded'})
    const result=await new ContextualTranslation({settings:()=>config,call,checkpoints}).translate(['Hello'],'en','pt-BR')
    expect(result.translations).toEqual(['Oi!'])
    expect(call.mock.calls.map(call=>call[0].provider)).toEqual(['deepseek','mimo','mimo'])
    expect(call.mock.calls[0][1].max_tokens).toBe(1024)
    config.consent.deepseek=false
    await expect(new ContextualTranslation({settings:()=>config,call,checkpoints}).translate(['Hello'],'en','pt-BR')).rejects.toMatchObject({code:'consent_required'})
    expect(call).toHaveBeenCalledTimes(3)
  })
  it('divide páginas extensas em lotes com contexto vizinho, sem perder falas', async () => {
    const config = settings(); config.review.enabled = false
    const call = vi.fn(async (_profile, body) => reply(JSON.parse(body.messages[1].content).lines.map((line: { id: number }) => ({ id: line.id, text: `Tradução ${line.id}` }))))
    const result = await new ContextualTranslation({ settings: () => config, call, limits: { maxLines: 20, contextTokens: 60000 } }).translate(Array.from({ length: 43 }, (_, i) => `Text ${i}`), 'auto', 'pt-BR')
    expect(result.translations).toHaveLength(43)
    expect(result.translations[42]).toBe('Tradução 42')
    expect(call).toHaveBeenCalledTimes(3)
    const second = JSON.parse(call.mock.calls[1][1].messages[1].content)
    // Contexto só com as vizinhas fora do lote: 3 antes e 3 depois.
    expect(second.contextOnly.map((item: { id: number }) => item.id)).toEqual([17, 18, 19, 40, 41, 42])
  })

  it('manda o capítulo inteiro numa chamada e só divide para ficar abaixo do teto de contexto', async () => {
    const config = settings(); config.review.enabled = false
    const call = vi.fn(async (_profile, body) => reply(JSON.parse(body.messages[1].content).lines.map((line: { id: number }) => ({ id: line.id, text: 'ok' }))))
    const chapter = Array.from({ length: 145 }, (_, i) => `Line number ${i} of a typical chapter balloon.`)
    await new ContextualTranslation({ settings: () => config, call }).translate(chapter, 'en', 'pt-BR')
    expect(call).toHaveBeenCalledTimes(1)
    const big = Array.from({ length: 300 }, () => '가'.repeat(400))
    call.mockClear()
    await new ContextualTranslation({ settings: () => config, call }).translate(big, 'ko', 'pt-BR')
    expect(call.mock.calls.length).toBeGreaterThan(1)
    for (const [, body] of call.mock.calls) expect(estimateTokens(JSON.stringify(body)) * 1.2).toBeLessThan(100000)
  })

  it('divide um lote mal respondido em partes menores em vez de descartá-lo', async () => {
    const config = settings(); config.review.enabled = false
    const call = vi.fn(async (_profile, body) => {
      const lines = JSON.parse(body.messages[1].content).lines as Array<{ id: number }>
      return lines.length > 1 ? reply(lines.slice(1).map((line) => ({ id: line.id, text: 'x' }))) : reply([{ id: lines[0].id, text: `T${lines[0].id}` }])
    })
    const result = await new ContextualTranslation({ settings: () => config, call }).translate(['A', 'B', 'C'], 'en', 'pt-BR')
    expect(result.translations).toEqual(['T0', 'T1', 'T2'])
  })

  it('mantém a adaptação quando a revisão responde fora do formato e marca as falas', async () => {
    const bad = reply([]); bad.choices[0].message.content = 'não é JSON'
    const call = vi.fn().mockResolvedValueOnce(reply([{ id: 0, text: 'Olá' }])).mockResolvedValueOnce(bad)
    const result = await new ContextualTranslation({ settings, call }).translate(['Hello'], 'en', 'pt-BR')
    expect(result.translations).toEqual(['Olá'])
    expect(result.flagged).toEqual([0])
  })

  it('respeita consentimento específico, independente do legado', async () => {
    const config = settings(); config.consent.deepseek = false
    const call = vi.fn()
    await expect(new ContextualTranslation({ settings: () => config, call }).translate(['Hello'], 'en', 'pt-BR')).rejects.toMatchObject({ code: 'consent_required' })
    expect(call).not.toHaveBeenCalled()
  })

  it('interrompe antes da revisão quando as preferências mudam durante a chamada', async () => {
    let config = settings()
    const call = vi.fn(async () => { config = { ...config, enabled: false }; return reply([{ id: 0, text: 'Olá' }]) })
    await expect(new ContextualTranslation({ settings: () => config, call }).translate(['Hello'], 'en', 'pt-BR')).rejects.toMatchObject({ code: 'settings_changed' })
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('não troca de provedor nem devolve o original após recusa', async () => {
    const call = vi.fn().mockRejectedValue(new TranslationError('user_denied', 'Recusado', 502))
    await expect(new ContextualTranslation({ settings, call }).translate(['Hello'], 'en', 'pt-BR')).rejects.toThrow('Recusado')
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('serializa páginas para evitar autorizações concorrentes no cofre', async () => {
    const config = settings(); config.review.enabled = false
    let finish!: () => void
    const wait = new Promise<void>((resolve) => { finish = resolve })
    const call = vi.fn().mockImplementationOnce(async () => { await wait; return reply([{ id: 0, text: 'Primeira' }]) }).mockResolvedValue(reply([{ id: 0, text: 'Segunda' }]))
    const engine = new ContextualTranslation({ settings: () => config, call })
    const first = engine.translate(['One'], 'en', 'pt-BR')
    const second = engine.translate(['Two'], 'en', 'pt-BR')
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1))
    finish()
    expect((await first).translations).toEqual(['Primeira'])
    expect((await second).translations).toEqual(['Segunda'])
  })

  it.each([
    { translations: [{ id: 0, text: 'Olá', needsReview: false }, { id: 0, text: 'Oi', needsReview: false }] },
    { translations: [] },
    { translations: [{ id: 9, text: 'Olá', needsReview: false }] },
  ])('rejeita mapeamento incompleto ou duplicado: %j', (value) => {
    const data = reply([]); data.choices[0].message.content = JSON.stringify(value)
    expect(() => readSceneReply(data, [0])).toThrow()
  })

  it('recusa saída truncada e sinaliza, sem descartar, a fala incerta', () => {
    const data = reply([{ id: 0, text: 'Olá' }]); data.choices[0].finish_reason = 'length'
    expect(() => readSceneReply(data, [0])).toThrow('não concluiu')
    data.choices[0].finish_reason = 'stop'
    data.choices[0].message.content = JSON.stringify({ translations: [{ id: 0, text: '???', needsReview: true }] })
    expect(readSceneReply(data, [0])).toMatchObject({ lines: [{ id: 0, text: '???' }], flagged: [0] })
  })

  it('não inventa consumo quando o provedor não informa', () => {
    const data: Record<string, unknown> = reply([{ id: 0, text: 'Olá' }]); delete data.usage
    expect(readSceneReply(data, [0]).usage).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null })
  })
  it('rejeita idioma e tamanho inválidos antes de enviar textos', async () => {
    const call = vi.fn()
    const engine = new ContextualTranslation({ settings, call })
    await expect(engine.translate(['Test'], 'en\nnew instruction', 'pt-BR')).rejects.toMatchObject({ code: 'unsupported_language' })
    await expect(engine.translate(['x'.repeat(5001)], 'en', 'pt-BR')).rejects.toMatchObject({ code: 'invalid_scene' })
    expect(call).not.toHaveBeenCalled()
  })
})

describe('configuração sem chaves de API', () => {
  it('começa desativada e não herda autorização', () => { expect(Object.values(defaultTranslationSettings().consent).every((value) => value === false)).toBe(true) })
  it('configuração antiga ganha os provedores novos sem autorização', () => {
    const old = { ...defaultTranslationSettings(), consent: { deepseek: true, mimo: true } }
    expect(parseTranslationSettings(old).consent).toMatchObject({ deepseek: true, mimo: true, openai: false, anthropic: false, zai: false })
  })
  it('aceita referências e rejeita API keys ou campos de segredo', () => {
    expect(parseTranslationSettings(settings()).translation.credentialId).toBe(ID)
    const value = settings(); value.translation.credentialId = 'sk-test-only-not-a-real-key'
    expect(() => parseTranslationSettings(value)).toThrow('UUID')
    expect(() => parseTranslationSettings({ ...settings(), apiKey: 'synthetic' })).toThrow('Não envie chaves')
  })
  it('exige configuração e consentimento das etapas ativas', () => {
    const config = settings(); config.consent.mimo = false
    expect(() => parseTranslationSettings(config)).toThrow('MiMo')
    config.review.enabled = false
    expect(parseTranslationSettings(config).enabled).toBe(true)
    config.translation.model = ''
    expect(() => parseTranslationSettings(config)).toThrow('Preencha')
  })
})

describe('paralelismo após a primeira autorização', () => {
  it('traduz lotes em paralelo depois que o cofre respondeu uma vez', async () => {
    const config = defaultTranslationSettings(); config.enabled = true
    config.translation = { provider: 'deepseek', model: 'm', credentialId: '' }; config.review.enabled = false; config.consent = { ...config.consent, deepseek: true, mimo: false }
    const ok = (text: string) => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations: [{ id: 0, text, needsReview: false }] }) } }] })
    let active = 0; let peak = 0
    const call = vi.fn(async () => { active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 5)); active--; return ok('Oi') })
    const engine = new ContextualTranslation({ settings: () => config, call })
    await engine.translate(['Hi'], 'en', 'pt-BR')
    expect(peak).toBe(1)
    await Promise.all([engine.translate(['A'], 'en', 'pt-BR'), engine.translate(['B'], 'en', 'pt-BR'), engine.translate(['C'], 'en', 'pt-BR')])
    expect(peak).toBe(3)
  })
})

describe('formato do pedido por provedor', () => {
  it('usa max_completion_tokens no GPT, Messages na Anthropic e lê a resposta da Anthropic', () => {
    const config = defaultTranslationSettings()
    const gpt = requestBody({ provider: 'openai', model: 'gpt-5.4-mini', credentialId: '' }, false, 'en', config, 2048, '{}')
    expect(gpt).toMatchObject({ max_completion_tokens: 2048, response_format: { type: 'json_object' } })
    expect(gpt).not.toHaveProperty('max_tokens'); expect(gpt).not.toHaveProperty('thinking')
    const claude = requestBody({ provider: 'anthropic', model: 'claude-haiku-5-5', credentialId: '' }, true, 'en', config, 2048, '{}')
    expect(claude).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 2048, messages: [{ role: 'user', content: '{}' }] })
    expect(typeof (claude as { system: string }).system).toBe('string')
    const reply = normalizeReply({ model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '```json\n{"translations":[{"id":0,"text":"Olá","needsReview":false}]}\n```' }], usage: { input_tokens: 10, output_tokens: 5 } })
    expect(readSceneReply(reply, [0])).toMatchObject({ lines: [{ id: 0, text: 'Olá' }], usage: { totalTokens: 15 } })
  })
  it('lê a saída do Claude Code (assinatura) e usa o formato Messages', () => {
    const body = requestBody({ provider: 'claude-code', model: 'haiku', credentialId: '' }, false, 'en', defaultTranslationSettings(), 1024, '{"lines":[]}')
    expect(body).toMatchObject({ model: 'haiku', messages: [{ role: 'user', content: '{"lines":[]}' }] })
    const reply = normalizeReply({ type: 'result', is_error: false, result: '{"translations":[{"id":0,"text":"Conseguimos!","needsReview":false}]}', usage: { input_tokens: 3, output_tokens: 4 }, modelUsage: { 'claude-haiku-5-5': {} } })
    expect(readSceneReply(reply, [0])).toMatchObject({ lines: [{ id: 0, text: 'Conseguimos!' }], model: 'claude-haiku-5-5', usage: { totalTokens: 7 } })
  })
})

describe('GLM Flash grátis', () => {
  it('manda um lote de cada vez', async () => {
    const config = { enabled: true, translation: { provider: 'zai', model: 'glm-4.7-flash', credentialId: '' }, review: { provider: 'zai', model: 'glm-4.7-flash', credentialId: '', enabled: false }, consent: { zai: true }, glossary: '', voices: '' } as never
    let active = 0; let peak = 0
    const call = async (_profile: unknown, body: Record<string, unknown>) => {
      active++; peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 20))
      active--
      const messages = body.messages as Array<{ content: string }>
      const user = JSON.parse(messages[messages.length - 1].content) as { lines: Array<{ id: number }> }
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations: user.lines.map((line) => ({ id: line.id, text: 'Oi', needsReview: false })) }) } }] }
    }
    const engine = new ContextualTranslation({ settings: () => config, call: call as never })
    await Promise.all([engine.translate(['A'], 'en', 'pt-BR'), engine.translate(['B'], 'en', 'pt-BR'), engine.translate(['C'], 'en', 'pt-BR')])
    expect(peak).toBe(1)
  })
})
