import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TranslationError, type ModelProfile } from './settings'

// Tradução pela assinatura do Claude (Pro/Max) usando o Claude Code instalado e
// logado neste computador, em modo não interativo. Sem ferramentas, sem
// configurações/plugins do usuário e sem sessão salva: só texto entra e sai.
export function claudeBinary() {
  const candidates = (process.platform === 'win32'
    ? [process.env.KOMA_CLAUDE_BIN, path.join(os.homedir(), '.local', 'bin', 'claude.exe')]
    : [process.env.KOMA_CLAUDE_BIN, path.join(os.homedir(), '.local/bin/claude'), '/usr/local/bin/claude', '/usr/bin/claude']).filter(Boolean) as string[]
  return candidates.find((file) => { try { return fs.statSync(file).isFile() } catch { return false } }) || 'claude'
}

export function runClaudeCode(profile: ModelProfile, body: Record<string, unknown>): Promise<unknown> {
  const system = String(body.system || '')
  const user = ((body.messages as Array<{ content: string }> | undefined) || []).map((message) => message.content).join('\n')
  // Com recortes de imagem, a mensagem vai em JSON por linha (texto + imagens) e a resposta também.
  const images = (body.images as Buffer[] | undefined) || []
  const args = ['-p', '--setting-sources', '', '--strict-mcp-config', '--tools', '', '--no-session-persistence', ...(images.length ? ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'] : ['--output-format', 'json']), '--model', profile.model, '--system-prompt', system]
  return new Promise((resolve, reject) => {
    const child = spawn(claudeBinary(), args, { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '', MAX_THINKING_TOKENS: '0' } })
    let stdout = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new TranslationError('provider_unavailable', 'O Claude Code não respondeu a tempo.', 504)) }, 180000)
    child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.length > 4 * 1024 * 1024) child.kill('SIGKILL') })
    child.stderr.resume() // Diagnóstico do programa nunca é registrado.
    child.on('error', () => { clearTimeout(timer); reject(new TranslationError('not_configured', 'Claude Code não encontrado neste computador. Instale e faça login para usar a assinatura.', 503)) })
    child.on('close', () => {
      clearTimeout(timer)
      let result: { is_error?: boolean; result?: string; api_error_status?: number | null } | undefined
      try { result = images.length ? stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line)).find((event) => event.type === 'result') : JSON.parse(stdout) } catch { return reject(new TranslationError('invalid_response', 'O Claude Code retornou uma resposta inválida.', 502)) }
      if (!result) return reject(new TranslationError('invalid_response', 'O Claude Code retornou uma resposta inválida.', 502))
      if (result?.is_error) {
        const text = String(result.result || '')
        if (/not logged in|login/i.test(text)) return reject(new TranslationError('not_configured', 'Faça login no Claude Code (comando claude) com sua assinatura para usar este provedor.', 401))
        if (/limit|quota|rate/i.test(text) || result.api_error_status === 429) return reject(new TranslationError('quota_exceeded', 'O limite de uso da assinatura Claude foi atingido. A fila tenta de novo depois.', 429))
        return reject(new TranslationError('provider_unavailable', 'O Claude Code não concluiu a tradução.', 502))
      }
      resolve(result)
    })
    child.stdin.end(images.length ? `${JSON.stringify({ type: 'user', message: { role: 'user', content: [...images.map((png) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } })), { type: 'text', text: user }] } })}\n` : user)
  })
}
