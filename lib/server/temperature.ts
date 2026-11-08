import { execFile, spawn, type ChildProcess } from 'node:child_process'
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

const NVIDIA_QUERY = ['--query-gpu=temperature.gpu', '--format=csv,noheader,nounits']
const NVIDIA_TIMEOUT_MS = 3000
const hottestValue = (lines: string[]) => {
  const values = lines.map(Number).filter((value) => Number.isFinite(value) && value > 0)
  return values.length ? Math.max(...values) : null
}

let nvidiaSmiMissing = false
function execNvidiaSmi(): Promise<number | null> {
  if (nvidiaSmiMissing) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile('nvidia-smi', NVIDIA_QUERY, { timeout: NVIDIA_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') nvidiaSmiMissing = true
      resolve(error ? null : hottestValue(String(stdout || '').split(/\r?\n/)))
    })
  })
}

/**
 * Consulta ao nvidia-smi por um shell pequeno que fica aberto (Linux). Abrir um processo a
 * partir do servidor, que passa de 2 GB com os modelos carregados, prendia a thread dele por
 * ~110 ms a cada leitura (o kernel copia o mapa de memória inteiro); a partir do shell custa
 * quase nada. Mesma consulta, mesmo prazo de 3 s e o mesmo resultado; o shell só roda o
 * comando quando recebe um pedido e fecha junto com o KOMA.
 */
export function nvidiaSmiShell(command = 'nvidia-smi', timeout = NVIDIA_TIMEOUT_MS) {
  type Pending = { resolve: (value: number | null) => void; lines: string[]; timer: ReturnType<typeof setTimeout> }
  const pending: Pending[] = []
  let shell: ChildProcess | null = null
  let buffer = ''
  let missing = false
  // Sem /bin/sh (não deve acontecer no Linux): volta para a consulta direta.
  let direct = false
  const reset = () => {
    shell?.kill()
    shell = null
    buffer = ''
    for (const entry of pending.splice(0)) {
      clearTimeout(entry.timer)
      entry.resolve(null)
    }
  }
  const start = () => {
    const child = spawn('/bin/sh', ['-c', `while read -r _; do "$0" ${NVIDIA_QUERY.join(' ')} 2>/dev/null; echo "fim $?"; done`, command], {
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (chunk: string) => {
      buffer += chunk
      for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
        const line = buffer.slice(0, end).trim()
        buffer = buffer.slice(end + 1)
        const current = pending[0]
        if (!current) continue
        const done = /^fim (\d+)$/.exec(line)
        if (!done) {
          current.lines.push(line)
          continue
        }
        pending.shift()
        clearTimeout(current.timer)
        // 127: o shell não achou o comando (nvidia-smi não instalado), como o ENOENT de antes.
        if (done[1] === '127') missing = true
        current.resolve(done[1] === '0' ? hottestValue(current.lines) : null)
      }
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') direct = true
      if (shell === child) reset()
    })
    child.on('exit', () => {
      if (shell === child) reset()
    })
    child.stdin!.on('error', () => undefined)
    // O shell não segura o KOMA aberto; ao sair, a entrada fecha e ele termina sozinho.
    child.unref()
    for (const stream of [child.stdin, child.stdout]) (stream as unknown as { unref?: () => void }).unref?.()
    return child
  }
  return (): Promise<number | null> => {
    if (missing) return Promise.resolve(null)
    if (direct) return execNvidiaSmi()
    shell ||= start()
    const child = shell
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (shell === child) reset()
      }, timeout)
      pending.push({ resolve, lines: [], timer })
      child.stdin!.write('\n')
    })
  }
}

// Um shell só para o servidor inteiro (o Next carrega uma cópia do módulo por rota).
const sharedSmi = globalThis as typeof globalThis & { __komaNvidiaSmi?: () => Promise<number | null> }
/** Temperatura da placa NVIDIA mais quente pelo nvidia-smi (Linux e Windows). */
export function queryNvidiaSmi(): Promise<number | null> {
  if (process.platform !== 'linux') return execNvidiaSmi()
  sharedSmi.__komaNvidiaSmi ||= nvidiaSmiShell()
  return sharedSmi.__komaNvidiaSmi()
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
