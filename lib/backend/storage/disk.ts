import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDataDir } from '../shared/data-paths'
import type { StorageSettings } from './settings'
import type { RcloneResult } from './rclone'

// Dispositivo externo (HD, SSD, pendrive, cartão de memória ou pasta de rede).
// A pasta do KOMA no dispositivo leva um koma-disco.json com um código único:
// é por ele que o KOMA reconhece o dispositivo, mesmo que o caminho de
// montagem ou a letra da unidade mude. Os arquivos são copiados direto, sem
// rclone, e só contam como guardados depois de conferidos pelo hash.

export const DISK_PREFIX = 'koma-disk:'
export const DISK_MARKER = 'koma-disco.json'
/** Resposta do executor quando o dispositivo não está conectado. */
export const DISK_MISSING = 'KOMA_DISK_MISSING'
interface Marker { format: 'koma-disco/1'; id: string; createdAt: string }

export class DiskMissingError extends Error {
  constructor(readonly label: string) {
    super(`O dispositivo ${label || 'externo'} não está conectado.`)
  }
}

function isDirectory(target: string) {
  try { return fs.statSync(target).isDirectory() } catch { return false }
}

function subdirectories(root: string) {
  try { return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name)) } catch { return [] }
}

/** Onde o sistema costuma montar dispositivos removíveis. KOMA_DISK_ROOTS troca a lista (testes). */
export function candidateMounts(): string[] {
  if (process.env.KOMA_DISK_ROOTS) return process.env.KOMA_DISK_ROOTS.split(path.delimiter).filter(Boolean).flatMap(subdirectories)
  if (process.platform === 'win32') {
    const system = (process.env.SystemDrive || 'C:').toUpperCase()
    return 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `${letter}:\\`).filter((root) => !root.startsWith(system) && isDirectory(root))
  }
  if (process.platform === 'darwin') return subdirectories('/Volumes').filter((dir) => !fs.lstatSync(dir).isSymbolicLink())
  const user = os.userInfo().username
  return [...subdirectories(path.join('/run/media', user)), ...subdirectories(path.join('/media', user)), ...subdirectories('/media').filter((dir) => path.basename(dir) !== user), ...subdirectories('/mnt')]
}

export function readMarker(mount: string, folder: string): Marker | null {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(mount, folder, DISK_MARKER), 'utf8')) as Marker
    return marker?.format === 'koma-disco/1' && /^[0-9a-f-]{36}$/.test(marker.id) ? marker : null
  } catch { return null }
}

const found = new Map<string, { mount: string | null; at: number }>()

/** Pontos de montagem atuais pela tabela do sistema (Linux), sem tocar no disco. */
function mountedPaths(): Set<string> | null {
  if (process.platform !== 'linux') return null
  try {
    return new Set(
      fs
        .readFileSync('/proc/self/mounts', 'utf8')
        .split('\n')
        .map((line) => line.split(' ')[1])
        .filter(Boolean)
        .map((field) => field.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)))),
    )
  } catch {
    return null
  }
}

/**
 * Caminho atual do dispositivo escolhido, ou null se ele não está conectado.
 * Depois de conferido o koma-disco.json, o KOMA só olha a tabela de montagem
 * enquanto o dispositivo continuar montado: assim um HD parado pode dormir.
 */
export function findDisk(settings: Pick<StorageSettings, 'diskId' | 'diskPath' | 'folder'>): string | null {
  if (!settings.diskId) return null
  const cached = found.get(settings.diskId)
  if (cached?.mount && mountedPaths()?.has(cached.mount)) return cached.mount
  if (cached && Date.now() - cached.at < 5000) return cached.mount
  const places = [settings.diskPath, cached?.mount, ...candidateMounts()].filter((place): place is string => Boolean(place))
  const mount = places.find((place) => readMarker(place, settings.folder)?.id === settings.diskId) ?? null
  found.set(settings.diskId, { mount, at: Date.now() })
  return mount
}

export function forgetDiskCache() {
  found.clear()
  listed = null
}

export function diskSpace(mount: string) {
  try {
    const stats = fs.statfsSync(mount)
    return { total: stats.blocks * stats.bsize, free: stats.bavail * stats.bsize, used: (stats.blocks - stats.bfree) * stats.bsize }
  } catch { return null }
}

export interface DiskChoice { path: string; label: string; total: number | null; free: number | null; hasKoma: boolean }

let listed: { folder: string; at: number; disks: DiskChoice[] } | null = null

/** Dispositivos conectados agora, para a pessoa escolher em Preferências (guardado por 1 min para não acordar HDs). */
export function listDisks(folder: string): DiskChoice[] {
  const mounts = candidateMounts()
  if (listed && listed.folder === folder && Date.now() - listed.at < 60000 && listed.disks.length === mounts.length && listed.disks.every((disk, i) => disk.path === mounts[i]))
    return listed.disks
  const disks = mounts.map((mount) => {
    const space = diskSpace(mount)
    return { path: mount, label: diskLabel(mount), total: space?.total ?? null, free: space?.free ?? null, hasKoma: Boolean(readMarker(mount, folder)) }
  })
  listed = { folder, at: Date.now(), disks }
  return disks
}

export function diskLabel(mount: string) {
  return path.basename(mount.replace(/[\\/]+$/, '')) || mount
}

const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * Prepara a pasta do KOMA no dispositivo e devolve o código dele. Se a pasta
 * já tem um koma-disco.json (outro computador, reinstalação), reaproveita.
 */
export function setupDisk(mount: string, folder: string) {
  const target = path.resolve(mount)
  if (!path.isAbsolute(mount) || !isDirectory(target)) throw new Error('Este dispositivo não está disponível.')
  if (inside(getDataDir(), target) || inside(target, getDataDir())) throw new Error('Escolha um dispositivo diferente da pasta da biblioteca.')
  const existing = readMarker(target, folder)
  if (existing) return { id: existing.id, path: target, label: diskLabel(target) }
  const dir = path.join(target, folder)
  try {
    fs.mkdirSync(dir, { recursive: true })
    const marker: Marker = { format: 'koma-disco/1', id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    fs.writeFileSync(path.join(dir, `${DISK_MARKER}.partial`), JSON.stringify(marker, null, 2))
    fs.renameSync(path.join(dir, `${DISK_MARKER}.partial`), path.join(dir, DISK_MARKER))
    forgetDiskCache()
    return { id: marker.id, path: target, label: diskLabel(target) }
  } catch {
    throw new Error('Não foi possível gravar no dispositivo. Confira se ele não está protegido contra gravação.')
  }
}

function resolveRemote(mount: string, remote: string) {
  const target = path.resolve(mount, remote.slice(DISK_PREFIX.length))
  if (!inside(mount, target) || target === path.resolve(mount)) throw new Error('Caminho inválido no dispositivo.')
  return target
}

export function sha1File(file: string) {
  const hash = crypto.createHash('sha1')
  const fd = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    for (let read = fs.readSync(fd, buffer); read > 0; read = fs.readSync(fd, buffer)) hash.update(buffer.subarray(0, read))
  } finally { fs.closeSync(fd) }
  return hash.digest('hex')
}

const result = (ok: boolean, stdout = '', stderr = ''): RcloneResult => ({ ok, stdout, stderr, missing: false })

/** Copia gravando primeiro um .partial: se o dispositivo sair no meio, a cópia incompleta nunca conta. */
function copyAtomic(from: string, to: string) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  const partial = `${to}.partial`
  try {
    fs.copyFileSync(from, partial)
    const fd = fs.openSync(partial, 'r+')
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(partial, to)
  } catch (error) {
    fs.rmSync(partial, { force: true })
    throw error
  }
}

/** Mesmos comandos que o KOMA usa do rclone (copyto, lsjson), mais "sha1", sobre o dispositivo externo. */
export async function runDisk(settings: StorageSettings, args: string[]): Promise<RcloneResult> {
  const mount = findDisk(settings)
  if (!mount) return result(false, '', DISK_MISSING)
  try {
    const [command, first, second] = args
    if (command === 'copyto' && first && second) {
      if (second.startsWith(DISK_PREFIX)) copyAtomic(first, resolveRemote(mount, second))
      else if (first.startsWith(DISK_PREFIX)) copyAtomic(resolveRemote(mount, first), second)
      else return result(false, '', 'unexpected')
      return result(true)
    }
    if (command === 'lsjson' && first?.startsWith(DISK_PREFIX)) {
      const file = resolveRemote(mount, first)
      return result(true, JSON.stringify(fs.existsSync(file) ? [{ Size: fs.statSync(file).size }] : []))
    }
    if (command === 'sha1' && first?.startsWith(DISK_PREFIX)) return result(true, sha1File(resolveRemote(mount, first)))
    return result(false, '', 'unexpected')
  } catch (error) {
    // Dispositivo removido no meio da operação.
    if (!findDiskNow(settings)) return result(false, '', DISK_MISSING)
    const code = (error as NodeJS.ErrnoException).code
    return result(false, '', code === 'ENOSPC' ? 'insufficient space' : code === 'EROFS' || code === 'EACCES' ? 'read-only' : 'disk error')
  }
}

function findDiskNow(settings: StorageSettings) {
  found.delete(settings.diskId)
  return findDisk(settings)
}
