import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { lstat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { TranslationError, type ModelProfile } from './settings'
import { catalogProvider } from '@/lib/model-catalog'

const HELPER = '/usr/lib/KPassword/bridge/kpassword_mcp.py'
const PYTHON = '/usr/bin/python3'
const MAX_REPLY = 4 * 1024 * 1024
const ERRORS: Record<string, string> = {
  bridge_inactive: 'Ative a sessão do Secrets Bridge no KPassword.',
  session_expired: 'A sessão do KPassword expirou. Ative a ponte novamente.',
  user_denied: 'A chamada foi recusada no KPassword.',
  approval_expired: 'A autorização no KPassword expirou. Tente novamente.',
  permission_revoked: 'A autorização foi revogada no KPassword.',
  key_not_found: 'A credencial não está disponível na ponte. Confira o ID e a sessão do KPassword.',
  credential_ambiguous: 'Há mais de uma credencial desse provedor no cofre. Informe o ID UUID da credencial nas preferências.',
  quota_exceeded: 'O limite de chamadas do KPassword foi atingido. Aguarde antes de tentar novamente.',
  bridge_busy: 'O KPassword está aguardando outra autorização. Tente novamente depois.',
  provider_unavailable: 'O KPassword não conseguiu conectar ao provedor.',
  provider_http_error: 'O provedor recusou a chamada. Confira modelo, credencial e cota no KPassword.',
  unsupported_operation: 'A credencial do KPassword não é compatível com esta operação.',
  endpoint_unsafe: 'O conector do KPassword não passou na verificação de permissões.',
  vault_changed: 'O cofre foi alterado. Reative a sessão do KPassword.',
}

export async function inspectBridge() {
  if (process.platform !== 'linux') return { available: false, message: 'A integração KPassword está disponível no Linux.' }
  try {
    const helper = await lstat(HELPER)
    if (!helper.isFile() || (helper.mode & 0o022) !== 0) return { available: false, message: 'Reinstale o conector oficial do KPassword.' }
    const root = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share')
    const socketPath = path.join(root, 'com.kpassword.app/secrets-bridge/request.sock')
    for (const [file, socket] of [[path.dirname(socketPath), false], [socketPath, true]] as const) {
      const stat = await lstat(file)
      if (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || (socket ? !stat.isSocket() : !stat.isDirectory())) return { available: false, message: ERRORS.endpoint_unsafe }
    }
    return { available: true, message: 'Conector local encontrado. A autorização de cada etapa será solicitada pelo KPassword.' }
  } catch {
    return { available: false, message: 'Abra o KPassword e ative o Secrets Bridge. O conector oficial deve estar instalado.' }
  }
}

// O adaptador MCP oficial verifica SO_PEERCRED e mantém seu token no processo
// Python. Reutilizar a sessão permite a aprovação por modelo/credencial no cofre.
class BridgeClient {
  private child: ChildProcessWithoutNullStreams
  private nextId = 0
  private buffer = Buffer.alloc(0)
  private pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private ready: Promise<unknown>
  private closed = false

  constructor() {
    this.child = spawn(PYTHON, ['-I', HELPER], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stderr.resume() // Nunca registrar diagnósticos ou conteúdo do provedor.
    this.child.stdout.on('data', (chunk: Buffer) => this.receive(chunk))
    this.child.on('error', () => this.close())
    this.child.on('close', () => this.close())
    this.child.stdin.on('error', () => this.close())
    this.ready = this.rpc('initialize', {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'KOMA', version: '1.0.0' },
    }).then((reply) => {
      const result = reply.result as { serverInfo?: { name?: string } } | undefined
      if (result?.serverInfo?.name !== 'KPassword Secrets Bridge') throw new TranslationError('invalid_bridge', 'O conector não identificou o KPassword.', 503)
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    }).catch((error) => { this.close(); throw error })
  }

  private receive(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    if (this.buffer.length > MAX_REPLY * 3) return this.close()
    let newline: number
    while ((newline = this.buffer.indexOf(10)) >= 0) {
      const line = this.buffer.subarray(0, newline)
      this.buffer = this.buffer.subarray(newline + 1)
      try {
        const reply = JSON.parse(line.toString('utf8'))
        const request = this.pending.get(reply.id)
        if (!request) continue
        clearTimeout(request.timer)
        this.pending.delete(reply.id)
        if (reply.error) { request.reject(new TranslationError('bridge_unavailable', 'A sessão do KPassword foi interrompida. Reative a ponte e tente novamente.', 503)); this.close() }
        else request.resolve(reply)
      } catch { this.close() }
    }
  }

  private rpc(method: string, params: unknown): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new TranslationError('bridge_unavailable', ERRORS.bridge_inactive, 503))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(new TranslationError('bridge_timeout', 'O KPassword não respondeu a tempo. Confira a autorização no cofre.', 504)), 165000)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  close(error = new TranslationError('bridge_unavailable', 'A sessão do KPassword está indisponível. Ative a ponte e tente novamente.', 503)) {
    if (this.closed) return
    this.closed = true
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error) }
    this.pending.clear()
    this.child.kill('SIGKILL')
    if (client === this) client = undefined
  }

  async call(profile: ModelProfile, body: Record<string, unknown>): Promise<unknown> {
    await this.ready
    const { identifiers, operation } = catalogProvider(profile.provider)
    let result: { isError?: boolean; content?: Array<{ type?: string; text?: string }> } | undefined
    for (const provider of identifiers) {
      const reply = await this.rpc('tools/call', { name: 'api_request', arguments: { provider, ...(profile.credentialId ? { credential_id: profile.credentialId } : {}), operation, body } })
      result = reply.result as typeof result
      // Alias da mesma família: só tentar outro identificador se nenhuma chave
      // correspondeu. Não repetir chamadas recusadas ou enviadas ao provedor.
      if (!(result?.isError && result.content?.[0]?.text === 'key_not_found')) break
    }
    const text = result?.content?.find((part) => part.type === 'text')?.text
    if (result?.isError) {
      // Apenas códigos conhecidos saem do transporte; nunca respostas brutas.
      throw new TranslationError(text && ERRORS[text] ? text : 'provider_http_error', (text && ERRORS[text]) || ERRORS.provider_http_error, 502)
    }
    try {
      const value = JSON.parse(text || '')
      if (value.ok !== true || !Number.isInteger(value.status) || value.status < 200 || value.status >= 300 || !value.body) throw new Error()
      return value.body
    } catch { throw new TranslationError('invalid_response', 'O KPassword retornou uma resposta inválida.', 502) }
  }

  async ping() { await this.ready; await this.rpc('ping', {}) }
}

let client: BridgeClient | undefined
process.once('exit', () => client?.close())
export function closeBridge() { client?.close() }

export async function checkBridgeConnection() {
  const status = await inspectBridge()
  if (!status.available) throw new TranslationError('bridge_unavailable', status.message, 503)
  client ??= new BridgeClient()
  await client.ping()
  return { available: true, message: 'Conexão com o KPassword verificada, sem enviar textos nem consumir cota. Credenciais e modelos serão conferidos na primeira tradução.' }
}

export async function requestThroughBridge(profile: ModelProfile, body: Record<string, unknown>): Promise<unknown> {
  const status = await inspectBridge()
  if (!status.available) throw new TranslationError('bridge_unavailable', status.message, 503)
  if (Buffer.byteLength(JSON.stringify(body)) > 1024 * 1024 - 2048) throw new TranslationError('request_too_large', 'A cena ultrapassa o limite de envio do KPassword.')
  client ??= new BridgeClient()
  return client.call(profile, body)
}
