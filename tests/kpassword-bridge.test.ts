import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { spawn, lstat } = vi.hoisted(() => ({ spawn: vi.fn(), lstat: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn }))
vi.mock('node:fs/promises', () => ({ lstat }))
import { closeBridge, inspectBridge, requestThroughBridge } from '../lib/backend/kpassword/bridge'

const profile = { provider: 'deepseek' as const, model: 'test', credentialId: '11111111-1111-4111-8111-111111111111' }
let requests: Array<Record<string, unknown>>
let answer: (params: { arguments: { provider: string } }) => unknown

beforeEach(() => {
  requests = []
  lstat.mockResolvedValue({ uid: process.getuid?.(), mode: 0o100600, isFile: () => true, isDirectory: () => true, isSocket: () => true })
  answer = () => ({
    content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 200, body: { choices: ['synthetic-response'] } }) }],
    isError: false,
  })
  spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: Object.assign(new EventEmitter(), { write: vi.fn() }),
      kill: vi.fn(),
    })
    child.stdin.write.mockImplementation((line: string) => {
      const message = JSON.parse(line)
      requests.push(message)
      if (!message.id) return
      queueMicrotask(() =>
        child.stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: message.method === 'initialize' ? { serverInfo: { name: 'KPassword Secrets Bridge' } } : answer(message.params),
          }) + '\n',
        ),
      )
      return true
    })
    return child
  })
})
afterEach(() => {
  closeBridge()
  vi.clearAllMocks()
})

describe('transporte KPassword sem exportar credenciais', () => {
  it('usa helper fixo sem shell e resolve provedor e ID juntos, reutilizando a sessão', async () => {
    expect(await requestThroughBridge(profile, { model: 'test', messages: [] })).toEqual({ choices: ['synthetic-response'] })
    await requestThroughBridge(profile, { model: 'test', messages: [] })
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn.mock.calls[0].slice(0, 2)).toEqual(['/usr/bin/python3', ['-I', '/usr/lib/KPassword/bridge/kpassword_mcp.py']])
    const calls = requests.filter((request) => request.method === 'tools/call')
    expect(calls[0].params).toEqual({
      name: 'api_request',
      arguments: {
        provider: 'DEEPSEEK_API_KEY',
        credential_id: profile.credentialId,
        operation: 'chat',
        body: { model: 'test', messages: [] },
      },
    })
    expect(JSON.stringify(requests)).not.toContain('Authorization')
  })
  it('recusa endpoint com permissões abertas antes de iniciar o processo', async () => {
    lstat.mockResolvedValue({ mode: 0o100666, isFile: () => true })
    expect((await inspectBridge()).available).toBe(false)
    await expect(requestThroughBridge(profile, {})).rejects.toThrow('conector')
    expect(spawn).not.toHaveBeenCalled()
  })
  it('converte recusa em mensagem PT-BR sem repetir a chamada', async () => {
    answer = () => ({ isError: true, content: [{ type: 'text', text: 'user_denied' }] })
    await expect(requestThroughBridge(profile, {})).rejects.toMatchObject({
      code: 'user_denied',
      message: 'A chamada foi recusada no KPassword.',
    })
    expect(requests.filter((request) => request.method === 'tools/call')).toHaveLength(1)
  })
  it('não expõe erros brutos do provedor', async () => {
    answer = () => ({ isError: true, content: [{ type: 'text', text: 'synthetic-private-error-body' }] })
    await expect(requestThroughBridge(profile, {})).rejects.toMatchObject({ code: 'provider_http_error' })
  })
  it('aceita o alias Xiaomi somente após chave não encontrada, sem trocar de serviço', async () => {
    answer = (params) =>
      params.arguments.provider === 'MIMO_API_KEY'
        ? { isError: true, content: [{ type: 'text', text: 'key_not_found' }] }
        : { isError: false, content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 200, body: { ok: true } }) }] }
    await expect(requestThroughBridge({ ...profile, provider: 'mimo' }, {})).resolves.toEqual({ ok: true })
    expect(
      requests.filter((r) => r.method === 'tools/call').map((r) => (r.params as { arguments: { provider: string } }).arguments.provider),
    ).toEqual(['MIMO_API_KEY', 'XIAOMI_API_KEY'])
  })
  it('abre outra sessão depois de fechar o conector', async () => {
    const pending = requestThroughBridge(profile, {})
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled())
    await pending
    closeBridge()
    await requestThroughBridge(profile, {})
    expect(spawn).toHaveBeenCalledTimes(2)
  })
})
