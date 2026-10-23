import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Temperaturas do processador e da placa de vídeo, para a guarda de temperatura
// (lib/backend/works/usage-limit.ts). Sem administrador: no Linux, os sensores do
// kernel (hwmon); no Windows só a placa NVIDIA (nvidia-smi), porque a CPU exige
// administrador. Uma leitura que falha vira null e a guarda ignora aquele sensor.
export interface Temperatures {
  cpu: number | null
  gpu: number | null
}

export interface TemperatureOptions {
  /** Ler também a placa de vídeo (só quando o KOMA a usa). */
  gpu: boolean
  /** Raiz do sysfs (testes). */
  root?: string
  platform?: NodeJS.Platform
  nvidiaSmi?: () => Promise<number | null>
}

const CPU_SENSORS = new Set(['coretemp', 'k10temp', 'zenpower', 'cpu_thermal'])

function read(file: string) {
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
}

function list(dir: string) {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

/** Maior temperatura (°C) dos arquivos temp*_input de um sensor hwmon. */
function hottest(dir: string) {
  let max: number | null = null
  for (const file of list(dir)) {
    if (!/^temp\d+_input$/.test(file)) continue
    const value = Number(read(path.join(dir, file)))
    if (Number.isFinite(value) && value > 0) max = Math.max(max ?? 0, value / 1000)
  }
  return max
}

// Placa em suspensão (economia de energia do kernel): qualquer consulta a acordaria.
function awake(device: string) {
  const status = read(path.join(device, 'power', 'runtime_status'))
  return status === null || status === 'active'
}

let nvidiaSmiMissing = false
/** Temperatura da placa NVIDIA mais quente pelo nvidia-smi (Linux e Windows). */
export function queryNvidiaSmi(): Promise<number | null> {
  if (nvidiaSmiMissing) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=temperature.gpu', '--format=csv,noheader,nounits'],
      { timeout: 3000, windowsHide: true },
      (error, stdout) => {
        if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') nvidiaSmiMissing = true
        const values = String(stdout || '')
          .split(/\r?\n/)
          .map(Number)
          .filter((value) => Number.isFinite(value) && value > 0)
        resolve(error || !values.length ? null : Math.max(...values))
      },
    )
  })
}

export async function readTemperatures({
  gpu,
  root = '/sys',
  platform = process.platform,
  nvidiaSmi = queryNvidiaSmi,
}: TemperatureOptions): Promise<Temperatures> {
  if (platform !== 'linux') return { cpu: null, gpu: gpu && platform === 'win32' ? await nvidiaSmi() : null }
  let cpu: number | null = null
  let card: number | null = null
  const hwmon = path.join(root, 'class', 'hwmon')
  for (const entry of list(hwmon)) {
    const dir = path.join(hwmon, entry)
    const name = read(path.join(dir, 'name'))
    if (name && CPU_SENSORS.has(name)) {
      const value = hottest(dir)
      if (value !== null) cpu = Math.max(cpu ?? 0, value)
    } else if (gpu && name === 'amdgpu' && awake(path.join(dir, 'device'))) {
      const value = hottest(dir)
      if (value !== null) card = Math.max(card ?? 0, value)
    }
  }
  if (gpu) {
    // NVIDIA: o nvidia-smi acorda a placa; só consultar se todas estiverem acordadas.
    const devices = path.join(root, 'bus', 'pci', 'devices')
    const nvidia = list(devices)
      .map((entry) => path.join(devices, entry))
      .filter((device) => read(path.join(device, 'vendor')) === '0x10de' && read(path.join(device, 'class'))?.startsWith('0x03'))
    if (nvidia.length && nvidia.every(awake)) {
      const value = await nvidiaSmi()
      if (value !== null) card = Math.max(card ?? 0, value)
    }
  }
  return { cpu, gpu: card }
}
