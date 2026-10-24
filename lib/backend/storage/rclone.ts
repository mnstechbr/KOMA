import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDataDir } from '../shared/data-paths'
import type { StorageSettings } from './settings'
import { DISK_PREFIX } from './disk'

// O KOMA usa o rclone (MIT) para falar com Google Drive, OneDrive e outros 70
// serviços. O login acontece no navegador, pela página oficial de cada conta; o
// token fica num arquivo de configuração só do KOMA, legível apenas pelo usuário.

export const KOMA_REMOTES = { gdrive: 'koma-gdrive', onedrive: 'koma-onedrive' } as const

export function rcloneBinary() {
  if (process.env.KOMA_RCLONE) return process.env.KOMA_RCLONE
  const candidates = process.platform === 'win32'
    // winget, Scoop e Chocolatey; fora deles, o rclone.exe do PATH.
    ? [path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Links', 'rclone.exe'), path.join(os.homedir(), 'scoop', 'shims', 'rclone.exe'), path.join(process.env.ProgramData || 'C:\\ProgramData', 'chocolatey', 'bin', 'rclone.exe')]
    : ['/usr/bin/rclone', '/usr/local/bin/rclone', path.join(os.homedir(), '.local/bin/rclone'), path.join(os.homedir(), 'bin/rclone')]
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate
  return 'rclone'
}

export function komaRcloneConfig() {
  return path.join(getDataDir(), 'rclone.conf')
}

/** Argumentos de configuração: remotos do KOMA usam o arquivo próprio; "outro provedor" usa o rclone do usuário. */
function configArgs(settings: Pick<StorageSettings, 'provider'>) {
  return settings.provider === 'rclone' ? [] : ['--config', komaRcloneConfig()]
}

export function remoteRoot(settings: StorageSettings) {
  if (settings.provider === 'disk') return `${DISK_PREFIX}${settings.folder}`
  const remote = settings.provider === 'gdrive' ? `${KOMA_REMOTES.gdrive}:` : settings.provider === 'onedrive' ? `${KOMA_REMOTES.onedrive}:` : settings.remote
  return `${remote}${settings.folder}`
}

export interface RcloneResult { ok: boolean; stdout: string; stderr: string; missing: boolean }

export function runRclone(settings: Pick<StorageSettings, 'provider'>, args: string[], timeout = 10 * 60000): Promise<RcloneResult> {
  return new Promise((resolve) => {
    execFile(rcloneBinary(), [...configArgs(settings), ...args], { cwd: os.tmpdir(), timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } }, (error, stdout, stderr) => {
      const missing = (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
      resolve({ ok: !error, stdout: String(stdout), stderr: String(stderr), missing })
    })
  })
}

export async function rcloneInstalled() {
  const result = await runRclone({ provider: 'rclone' }, ['version'], 15000)
  return { installed: !result.missing && result.ok, version: result.stdout.split('\n')[0]?.trim() || '' }
}

export async function configuredRemotes(provider: StorageSettings['provider']) {
  const result = await runRclone({ provider }, ['listremotes'], 15000)
  return result.ok ? result.stdout.split('\n').map((line) => line.trim()).filter(Boolean) : []
}

// Situação da última tentativa de conexão, para a tela mostrar o andamento.
const connecting: Record<'gdrive' | 'onedrive', { running: boolean; error: string }> = { gdrive: { running: false, error: '' }, onedrive: { running: false, error: '' } }
export function connectionState(provider: 'gdrive' | 'onedrive') { return { ...connecting[provider] } }

/** Lê as seções do arquivo de configuração do KOMA (só nomes de campos, nunca os valores secretos). */
function remoteSections() {
  const sections = new Map<string, Map<string, string>>()
  let current: Map<string, string> | null = null
  for (const line of (fs.existsSync(komaRcloneConfig()) ? fs.readFileSync(komaRcloneConfig(), 'utf8') : '').split(/\r?\n/)) {
    const header = line.match(/^\[(.+)\]\s*$/)
    if (header) { current = new Map(); sections.set(header[1], current); continue }
    const pair = line.match(/^([a-z_]+)\s*=\s*(.*)$/)
    if (pair && current) current.set(pair[1], pair[2])
  }
  return sections
}

/** Conta conectada de verdade: o OneDrive também precisa saber qual drive usar. */
export function komaRemoteReady(provider: 'gdrive' | 'onedrive') {
  const section = remoteSections().get(KOMA_REMOTES[provider])
  if (!section?.get('token')) return false
  return provider === 'gdrive' || Boolean(section.get('drive_id') && section.get('drive_type'))
}

function writeRemote(name: string, fields: Record<string, string>) {
  const kept = fs.existsSync(komaRcloneConfig()) ? fs.readFileSync(komaRcloneConfig(), 'utf8').split(/(?=^\[)/m).filter((block) => !block.startsWith(`[${name}]`)).join('') : ''
  const block = `[${name}]\n${Object.entries(fields).map(([key, value]) => `${key} = ${value}`).join('\n')}\n\n`
  fs.writeFileSync(`${komaRcloneConfig()}.partial`, `${kept.trimEnd()}${kept.trim() ? '\n\n' : ''}${block}`, { mode: 0o600 })
  fs.renameSync(`${komaRcloneConfig()}.partial`, komaRcloneConfig())
}

/**
 * OneDrive: o login oficial abre no navegador (rclone authorize) e o KOMA
 * descobre sozinho qual é o drive pessoal pela API da Microsoft. O token fica só
 * no arquivo de configuração do KOMA (permissão 600) e nunca vai para os logs.
 */
async function connectOneDrive() {
  const result = await runRclone({ provider: 'onedrive' }, ['authorize', 'onedrive'], 10 * 60000)
  const token = result.stdout.match(/--->\s*(\{[\s\S]*?\})\s*<---/)?.[1]
  if (!token) throw new Error(result.missing ? 'O rclone não está instalado neste computador.' : 'O login do OneDrive não foi concluído. Tente conectar de novo.')
  const access = (JSON.parse(token) as { access_token?: string }).access_token
  const response = await fetch('https://graph.microsoft.com/v1.0/me/drive', { headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(30000) })
  const drive = await response.json().catch(() => ({})) as { id?: string; driveType?: string }
  if (!response.ok || !drive.id || !drive.driveType || !/^[A-Za-z0-9!._-]{1,200}$/.test(drive.id) || !/^(personal|business|documentLibrary)$/.test(drive.driveType)) throw new Error('A Microsoft não informou o OneDrive desta conta.')
  writeRemote(KOMA_REMOTES.onedrive, { type: 'onedrive', token: JSON.stringify(JSON.parse(token)), drive_id: drive.id, drive_type: drive.driveType })
}

/** Google Drive usa a permissão drive.file: o KOMA só enxerga os arquivos que ele mesmo criou. */
async function connectGoogleDrive() {
  const result = await runRclone({ provider: 'gdrive' }, ['config', 'create', KOMA_REMOTES.gdrive, 'drive', 'scope=drive.file'], 10 * 60000)
  if (!komaRemoteReady('gdrive')) throw new Error(result.missing ? 'O rclone não está instalado neste computador.' : 'O login do Google Drive não foi concluído. Tente conectar de novo.')
}

/** Abre o login oficial no navegador; a conexão termina em segundo plano. */
export function startConnect(provider: 'gdrive' | 'onedrive') {
  if (connecting[provider].running) return
  fs.mkdirSync(path.dirname(komaRcloneConfig()), { recursive: true })
  if (!fs.existsSync(komaRcloneConfig())) fs.writeFileSync(komaRcloneConfig(), '', { mode: 0o600 })
  fs.chmodSync(komaRcloneConfig(), 0o600)
  connecting[provider] = { running: true, error: '' }
  void (provider === 'onedrive' ? connectOneDrive() : connectGoogleDrive())
    .then(() => { connecting[provider] = { running: false, error: '' } })
    .catch((error) => { connecting[provider] = { running: false, error: error instanceof Error ? error.message : 'Não foi possível conectar.' } })
}

export async function disconnect(provider: 'gdrive' | 'onedrive') {
  await runRclone({ provider }, ['config', 'delete', KOMA_REMOTES[provider]], 15000)
}

/** Espaço da conta. Nem todo serviço informa; nesse caso volta null. */
export async function accountSpace(settings: StorageSettings) {
  const remote = remoteRoot(settings).split(':')[0] + ':'
  const result = await runRclone(settings, ['about', remote, '--json'], 30000)
  if (!result.ok) return null
  try {
    const data = JSON.parse(result.stdout) as { total?: number; used?: number; free?: number }
    return { total: data.total ?? null, used: data.used ?? null, free: data.free ?? null }
  } catch { return null }
}
