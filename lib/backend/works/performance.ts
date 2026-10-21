import os from 'node:os'
import type Database from 'better-sqlite3'

// Perfis de desempenho, medidos com 30 páginas reais (tests/ocr-benchmark.real.test.ts):
// - Leve (PC com até 4 núcleos ou até 8 GB): OCR com 2 páginas × 2 threads foi o
//   melhor numa máquina limitada a 4 núcleos (1,1 s/página, contra 1,5 s com 1 página).
// - Equilibrado: só o processador, como até a 0.4.24 (4 páginas × núcleos/4 threads,
//   0,73 s/página num i7 de 16 threads).
// - Máximo: OCR na placa de vídeo (WebGPU), 6 páginas × 2 threads, 0,26 s/página
//   no mesmo PC, com o mesmo texto reconhecido em 30 de 30 páginas.
export type PerformanceProfile = 'leve' | 'equilibrado' | 'maximo'
export type PerformanceMode = 'auto' | PerformanceProfile
export interface PerformanceLimits { downloads: number; ocrSlots: number; ocrThreads: number; ocrDevice: 'cpu' | 'webgpu'; translation: number; render: number; upgrade: number; imageThreads: number }

const KEY = 'koma:performance:v1'
const PROFILES: PerformanceProfile[] = ['leve', 'equilibrado', 'maximo']

export function hardware() {
  return { cores: os.availableParallelism(), memoryGb: Math.round(os.totalmem() / 1024 ** 3 * 10) / 10 }
}

export function limitsFor(profile: PerformanceProfile, cores = os.availableParallelism()): PerformanceLimits {
  if (profile === 'leve') return { downloads: 2, ocrSlots: cores >= 4 ? 2 : 1, ocrThreads: Math.min(2, cores), ocrDevice: 'cpu', translation: 2, render: 1, upgrade: 1, imageThreads: Math.min(2, cores) }
  if (profile === 'maximo') return { downloads: 6, ocrSlots: 6, ocrThreads: 2, ocrDevice: 'webgpu', translation: 6, render: 4, upgrade: 4, imageThreads: 0 }
  return { downloads: 4, ocrSlots: 4, ocrThreads: Math.max(1, Math.min(4, Math.floor(cores / 4))), ocrDevice: 'cpu', translation: 4, render: 4, upgrade: 4, imageThreads: 0 }
}

/** Automático: PC pequeno fica no Leve; com placa de vídeo que funciona, Máximo; senão Equilibrado. */
export function autoProfile(gpuAvailable: boolean, machine = hardware()): PerformanceProfile {
  if (machine.cores <= 4 || machine.memoryGb <= 8.5) return 'leve'
  return gpuAvailable ? 'maximo' : 'equilibrado'
}

export function getPerformanceMode(database: Database.Database): PerformanceMode {
  const row = database.prepare('SELECT value FROM kv_store WHERE key = ?').get(KEY) as { value: string } | undefined
  try { const mode = row ? JSON.parse(row.value).mode : 'auto'; return mode === 'auto' || PROFILES.includes(mode) ? mode : 'auto' } catch { return 'auto' }
}

export function savePerformanceMode(database: Database.Database, mode: unknown): PerformanceMode {
  if (mode !== 'auto' && !PROFILES.includes(mode as PerformanceProfile)) throw new Error('Perfil de desempenho inválido.')
  database.prepare(`INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = NULL`).run(KEY, JSON.stringify({ mode }))
  return mode as PerformanceMode
}

/** Perfil em uso: o escolhido, ou o automático. Máximo sem placa de vídeo vira Equilibrado. */
export function resolveProfile(mode: PerformanceMode, gpuAvailable: boolean, machine = hardware()): PerformanceProfile {
  if (mode === 'auto') return autoProfile(gpuAvailable, machine)
  if (mode === 'maximo' && !gpuAvailable) return 'equilibrado'
  return mode
}

// Estado em uso pelo processo (fila de preparação e OCR).
const runtime: { gpu: boolean | null; probing: Promise<boolean> | null } = { gpu: null, probing: null }

/** Testa a placa de vídeo uma vez por abertura do app. */
export function detectGpu(probe: () => Promise<{ available: boolean }>) {
  runtime.probing ||= probe().then((result) => { runtime.gpu = result.available; return result.available }).catch(() => { runtime.gpu = false; return false })
  return runtime.probing
}
export function gpuAvailable() { return runtime.gpu === true }

export function currentPerformance(database: Database.Database) {
  const mode = getPerformanceMode(database)
  const machine = hardware()
  const profile = resolveProfile(mode, gpuAvailable(), machine)
  return { mode, profile, limits: limitsFor(profile, machine.cores), machine, gpu: runtime.gpu }
}
