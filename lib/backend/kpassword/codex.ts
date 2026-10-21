import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TranslationError, type ModelProfile } from './settings'

// Tradução pela assinatura do ChatGPT usando o Codex (vem com o app do ChatGPT
// ou instalado à parte), já logado neste computador. Sem configurações do
// usuário, sem regras, sandbox somente leitura e sessão efêmera.
export function codexBinary() {
  const candidates = (process.platform === 'win32'
    ? [process.env.KOMA_CODEX_BIN, path.join(os.homedir(), '.local', 'bin', 'codex.exe')]
    : [process.env.KOMA_CODEX_BIN, '/usr/lib/chatgpt/resources/codex', path.join(os.homedir(), '.local/bin/codex'), '/usr/local/bin/codex', '/usr/bin/codex']).filter(Boolean) as string[]
  return candidates.find((file) => { try { return fs.statSync(file).isFile() } catch { return false } }) || 'codex'
}

export function runCodex(profile: ModelProfile, body: Record<string, unknown>): Promise<unknown> {
  const system = String(body.system || '')
  const user = ((body.messages as Array<{ content: string }> | undefined) || []).map((message) => message.content).join('\n')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koma-codex-'))
  const output = path.join(dir, 'resposta.txt')
  // Recortes de imagem (leitura de fala duvidosa) vão anexados ao pedido.
  const images = ((body.images as Buffer[] | undefined) || []).map((png, index) => { const file = path.join(dir, `fala-${index}.png`); fs.writeFileSync(file, png); return file })
  const args = ['exec', ...images.flatMap((file) => ['-i', file]), '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', '-s', 'read-only', '--color', 'never', '-C', dir, '-m', profile.model,
    // Tradução não precisa de raciocínio longo: esforço baixo responde bem mais rápido.
    '-c', 'model_reasoning_effort="low"', '-o', output, '-']
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true })
  return new Promise((resolve, reject) => {
    const child = spawn(codexBinary(), args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } })
    let log = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); cleanup(); reject(new TranslationError('provider_unavailable', 'O Codex não respondeu a tempo.', 504)) }, 180000)
    // Só o necessário para identificar login/limite; nunca registrado.
    const collect = (chunk: Buffer) => { if (log.length < 64 * 1024) log += chunk.toString() }
    child.stdout.on('data', collect); child.stderr.on('data', collect)
    child.on('error', () => { clearTimeout(timer); cleanup(); reject(new TranslationError('not_configured', 'Codex não encontrado. Instale o app do ChatGPT (ou o Codex) e faça login para usar a assinatura.', 503)) })
    child.on('close', (code) => {
      clearTimeout(timer)
      let text = ''
      try { text = fs.readFileSync(output, 'utf8').trim() } catch { /* Sem resposta: tratado abaixo. */ }
      cleanup()
      if (code !== 0 || !text) {
        if (/log ?in|not authenticated|unauthorized|401/i.test(log)) return reject(new TranslationError('not_configured', 'Faça login no Codex/ChatGPT com sua conta para usar este provedor.', 401))
        if (/usage limit|rate limit|quota|429/i.test(log)) return reject(new TranslationError('quota_exceeded', 'O limite de uso da assinatura ChatGPT foi atingido. A fila tenta de novo depois.', 429))
        return reject(new TranslationError('provider_unavailable', 'O Codex não concluiu a tradução.', 502))
      }
      const model = /^model:\s*(\S+)/m.exec(log)?.[1] || profile.model
      resolve({ type: 'result', is_error: false, result: text, modelUsage: { [model]: {} } })
    })
    child.stdin.end(`${system}\n\n${user}`)
  })
}
