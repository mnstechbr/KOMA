import { execFile, spawn } from 'node:child_process'
import os from 'node:os'
import { claudeBinary } from './claude-code'
import { codexBinary } from './codex'

// Situação das assinaturas usadas pelos provedores "Assinatura Claude" e
// "Assinatura ChatGPT". Só consulta o login dos programas oficiais; nenhuma
// credencial é lida, copiada ou guardada pelo KOMA.
export type SubscriptionId = 'claude-code' | 'chatgpt-codex'
export interface SubscriptionStatus {
  id: SubscriptionId
  name: string
  installed: boolean
  connected: boolean
  detail: string
}

function run(file: string, args: string[]) {
  return new Promise<{ ok: boolean; out: string }>((resolve) => {
    execFile(
      file,
      args,
      { cwd: os.tmpdir(), timeout: 15000, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } },
      (error, stdout, stderr) => {
        const code = (error as NodeJS.ErrnoException | null)?.code
        resolve({ ok: !error, out: `${stdout}${stderr}`, ...(code === 'ENOENT' ? { ok: false, out: 'ENOENT' } : {}) })
      },
    )
  })
}

export async function subscriptionStatus(): Promise<SubscriptionStatus[]> {
  const claude = await run(claudeBinary(), ['auth', 'status'])
  let claudeConnected = false
  try {
    claudeConnected = JSON.parse(claude.out).loggedIn === true
  } catch {
    /* Saída fora do esperado: não conectado. */
  }
  const codex = await run(codexBinary(), ['login', 'status'])
  const codexConnected = codex.ok && /logged in/i.test(codex.out)
  return [
    {
      id: 'claude-code',
      name: 'Assinatura Claude (Claude Code)',
      installed: claude.out !== 'ENOENT',
      connected: claudeConnected,
      detail:
        claude.out === 'ENOENT'
          ? 'Claude Code não encontrado neste computador.'
          : claudeConnected
            ? 'Conectado com a sua conta Claude.'
            : 'Instalado, mas sem login.',
    },
    {
      id: 'chatgpt-codex',
      name: 'Assinatura ChatGPT (Codex)',
      installed: codex.out !== 'ENOENT',
      connected: codexConnected,
      detail:
        codex.out === 'ENOENT'
          ? 'Codex não encontrado. Ele vem com o app do ChatGPT.'
          : codexConnected
            ? 'Conectado com a sua conta ChatGPT.'
            : 'Instalado, mas sem login.',
    },
  ]
}

/** Abre o login oficial do programa (o navegador pede a conta). */
export function connectSubscription(id: SubscriptionId) {
  const [file, args] = id === 'claude-code' ? [claudeBinary(), ['auth', 'login']] : [codexBinary(), ['login']]
  const child = spawn(file, args, {
    cwd: os.tmpdir(),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  })
  child.on('error', () => {
    /* Programa ausente: o status continua informando. */
  })
  child.unref()
}
