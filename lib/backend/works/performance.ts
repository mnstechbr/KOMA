import os from 'node:os'
import type Database from 'better-sqlite3'
import type { GpuProbe } from '@/lib/server/ocr-helpers'
import { HEAT_LIMITS, USAGE_LEVELS, usageState, type UsageLevel } from './usage-limit'

// Perfis de desempenho, medidos com 30 páginas reais (tests/ocr-benchmark.real.test.ts):
// - Leve (PC com até 4 núcleos ou até 8 GB): OCR com 2 páginas × 2 threads foi o
//   melhor numa máquina limitada a 4 núcleos (1,1 s/página, contra 1,5 s com 1 página).
// - Equilibrado: só o processador, como até a 0.4.24 (4 páginas × núcleos/4 threads,
//   0,73 s/página num i7 de 16 threads).
// - Máximo: OCR na placa de vídeo (WebGPU), 6 páginas × 2 threads, 0,26 s/página
//   no mesmo PC, com o mesmo texto reconhecido em 30 de 30 páginas.
export type PerformanceProfile = 'leve' | 'equilibrado' | 'maximo'
export type PerformanceMode = 'auto' | PerformanceProfile
export interface PerformanceLimits {
  downloads: number
  ocrSlots: number
  ocrThreads: number
  ocrDevice: 'cpu' | 'webgpu'
  translation: number
  render: number
  upgrade: number
  imageThreads: number
  /** Threads do ONNX no desenho (detector de letras e LaMa), no worker do desenho; 0 = padrão do onnxruntime. */
  drawThreads: number
}

const KEY = 'koma:performance:v1'
const PROFILES: PerformanceProfile[] = ['leve', 'equilibrado', 'maximo']

export function hardware() {
  return { cores: os.availableParallelism(), memoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10 }
}

export function limitsFor(profile: PerformanceProfile, cores = os.availableParallelism()): PerformanceLimits {
  if (profile === 'leve')
    return {
      downloads: 2,
      ocrSlots: cores >= 4 ? 2 : 1,
      ocrThreads: Math.min(2, cores),
      ocrDevice: 'cpu',
      translation: 2,
      render: 1,
      upgrade: 1,
      imageThreads: Math.min(2, cores),
      drawThreads: 0,
    }
  if (profile === 'maximo')
    return {
      downloads: 6,
      ocrSlots: 6,
      ocrThreads: 2,
      ocrDevice: 'webgpu',
      translation: 6,
      render: 4,
      upgrade: 4,
      imageThreads: 0,
      drawThreads: 0,
    }
  return {
    downloads: 4,
    ocrSlots: 4,
    ocrThreads: Math.max(1, Math.min(4, Math.floor(cores / 4))),
    ocrDevice: 'cpu',
    translation: 4,
    render: 4,
    upgrade: 4,
    imageThreads: 0,
    drawThreads: 0,
  }
}

/** Automático: PC pequeno fica no Leve; com placa de vídeo que funciona, Máximo; senão Equilibrado. */
export function autoProfile(gpuAvailable: boolean, machine = hardware()): PerformanceProfile {
  if (machine.cores <= 4 || machine.memoryGb <= 8.5) return 'leve'
  return gpuAvailable ? 'maximo' : 'equilibrado'
}

function readSettings(database: Database.Database): Record<string, unknown> {
  const row = database.prepare('SELECT value FROM kv_store WHERE key = ?').get(KEY) as { value: string } | undefined
  try {
    const value = row ? JSON.parse(row.value) : {}
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

function writeSettings(database: Database.Database, patch: Record<string, unknown>) {
  database
    .prepare(
      `INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = NULL`,
    )
    .run(KEY, JSON.stringify({ ...readSettings(database), ...patch }))
}

export function getPerformanceMode(database: Database.Database): PerformanceMode {
  const mode = readSettings(database).mode ?? 'auto'
  return mode === 'auto' || PROFILES.includes(mode as PerformanceProfile) ? (mode as PerformanceMode) : 'auto'
}

export function savePerformanceMode(database: Database.Database, mode: unknown): PerformanceMode {
  if (mode !== 'auto' && !PROFILES.includes(mode as PerformanceProfile)) throw new Error('Perfil de desempenho inválido.')
  writeSettings(database, { mode })
  return mode as PerformanceMode
}

/** Limite de uso escolhido: "Uso máximo" (100, 75 ou 50%) e a guarda de temperatura (ligada por padrão). */
export function getUsageLimit(database: Database.Database): { usage: UsageLevel; guard: boolean } {
  const settings = readSettings(database)
  return {
    usage: USAGE_LEVELS.includes(settings.usage as UsageLevel) ? (settings.usage as UsageLevel) : 100,
    guard: settings.guard !== false,
  }
}

export function saveUsageLimit(database: Database.Database, next: { usage?: unknown; guard?: unknown }) {
  if (next.usage !== undefined && !USAGE_LEVELS.includes(next.usage as UsageLevel)) throw new Error('Limite de uso inválido.')
  if (next.guard !== undefined && typeof next.guard !== 'boolean') throw new Error('Limite de uso inválido.')
  writeSettings(database, {
    ...(next.usage !== undefined ? { usage: next.usage } : {}),
    ...(next.guard !== undefined ? { guard: next.guard } : {}),
  })
  return getUsageLimit(database)
}

/** Perfil em uso: o escolhido, ou o automático. Máximo sem placa de vídeo vira Equilibrado. */
export function resolveProfile(mode: PerformanceMode, gpuAvailable: boolean, machine = hardware()): PerformanceProfile {
  if (mode === 'auto') return autoProfile(gpuAvailable, machine)
  if (mode === 'maximo' && !gpuAvailable) return 'equilibrado'
  return mode
}

// Estado em uso pelo processo (fila de preparação e OCR).
const runtime: {
  gpu: boolean | null
  speedup: number | null
  slowGpu: boolean
  wrongGpu: boolean
  probing: Promise<boolean> | null
} = {
  gpu: null,
  speedup: null,
  slowGpu: false,
  wrongGpu: false,
  probing: null,
}

/**
 * Testa a placa de vídeo uma vez por abertura do app. Ela só conta se for mais rápida que o
 * processador e der o mesmo resultado que ele (senão o perfil fica no Equilibrado).
 */
export function detectGpu(probe: () => Promise<GpuProbe>) {
  runtime.probing ||= probe()
    .then((result) => {
      runtime.gpu = result.available
      runtime.speedup = result.ms && result.cpuMs ? Math.round((result.cpuMs / result.ms) * 10) / 10 : null
      runtime.wrongGpu = !result.available && Boolean(result.wrong)
      runtime.slowGpu = !result.available && !runtime.wrongGpu && result.ms != null
      if (runtime.wrongGpu)
        console.warn('[KOMA] Placa de vídeo recusada: resultado diferente do processador', {
          model: result.wrong,
          drift: result.drift,
          ms: result.ms,
          cpuMs: result.cpuMs,
        })
      else console.info('[KOMA] Teste da placa de vídeo', result)
      return result.available
    })
    .catch(() => {
      runtime.gpu = false
      return false
    })
  return runtime.probing
}
export function gpuAvailable() {
  return runtime.gpu === true
}

export interface GraphicsCard {
  name: string
  kind: 'dedicated' | 'integrated' | null
  active: boolean
}
/**
 * Placas de vídeo informadas pela janela (Electron app.getGPUInfo, em KOMA_GPUS), só
 * para mostrar em Preferências; quem decide o perfil é a medição da própria placa.
 */
export function graphicsCards(raw = process.env.KOMA_GPUS): GraphicsCard[] {
  let list: Array<{ vendorId?: number; deviceId?: number; vendorString?: string; deviceString?: string; active?: boolean }>
  try {
    list = JSON.parse(raw || '[]')
    if (!Array.isArray(list)) return []
  } catch {
    return []
  }
  const vendors: Record<number, string> = { 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x8086: 'Intel' }
  return list
    .filter((card) => card && (card.vendorId || card.deviceString))
    .map((card) => {
      const vendor = vendors[card.vendorId || 0] || card.vendorString || ''
      const name =
        (card.deviceString || '').trim() || [vendor, (card.deviceId || 0).toString(16).padStart(4, '0')].filter(Boolean).join(' ')
      const device = card.deviceId || 0
      let kind: GraphicsCard['kind'] = null
      if (card.vendorId === 0x10de) kind = 'dedicated'
      else if (card.vendorId === 0x8086)
        // Intel Arc (placas dedicadas): 0x56xx e 0xe2xx; o resto é gráfico integrado.
        kind =
          /\bArc\b/i.test(name) || (device >= 0x5690 && device <= 0x56ff) || (device >= 0xe200 && device <= 0xe2ff)
            ? 'dedicated'
            : 'integrated'
      else if (card.vendorId === 0x1002)
        kind = /Radeon(\(TM\))? Graphics|Vega \d+ Graphics|Radeon \d{3}M\b/i.test(name)
          ? 'integrated'
          : /Radeon|FirePro/i.test(name)
            ? 'dedicated'
            : null
      return { name, kind, active: Boolean(card.active) }
    })
}

export function currentPerformance(database: Database.Database) {
  const mode = getPerformanceMode(database)
  const machine = hardware()
  const profile = resolveProfile(mode, gpuAvailable(), machine)
  return {
    mode,
    profile,
    limits: limitsFor(profile, machine.cores),
    machine,
    gpu: runtime.gpu,
    gpuSpeedup: runtime.speedup,
    slowGpu: runtime.slowGpu,
    wrongGpu: runtime.wrongGpu,
    cards: graphicsCards(),
    ...getUsageLimit(database),
    hot: usageState().hot,
    temps: usageState().temps,
    heatLimits: { cpu: HEAT_LIMITS.cpu, gpu: HEAT_LIMITS.gpu },
  }
}
