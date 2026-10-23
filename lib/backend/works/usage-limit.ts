import { readTemperatures, type TemperatureOptions, type Temperatures } from '@/lib/server/temperature'

// Limite de uso, para o computador não esquentar demais preparando capítulos:
// - "Uso máximo" (Preferências > Desempenho): o tempo em que algum trabalho pesado roda
//   (leitura ou desenho, somados como um só) é seguido de uma pausa geral proporcional
//   (75%: 1/3 do tempo; 50%: o mesmo tempo). A pausa vale para todos ao mesmo tempo e
//   só começa quando o que já estava rodando termina: descansar uma tarefa só, ou pausar
//   com outras ainda na fila da placa, não deixava o computador parado (medido: 75% dava
//   o mesmo calor que 100%).
// - Guarda de temperatura (ligada por padrão): CPU a partir de 90 °C ou placa a partir
//   de 83 °C, o KOMA passa a no máximo metade do tempo e metade das tarefas ao mesmo
//   tempo, até as duas caírem HEAT_LIMITS.margin graus. Nunca para de vez.
// Download e tradução não esquentam (rede) e não passam por aqui.
export type UsageLevel = 100 | 75 | 50
export const USAGE_LEVELS: UsageLevel[] = [100, 75, 50]
export const HEAT_LIMITS = { cpu: 90, gpu: 83, margin: 5 }
const HOT_SHARE = 0.5
// Leitura dos sensores no máximo a cada 5 s, e só enquanto há trabalho.
const READ_EVERY_MS = 5000
// Descanso máximo depois de uma página muito longa, e mínimo para valer uma pausa.
const MAX_REST_MS = 60000
const MIN_PAUSE_MS = 250

export type UsageKind = 'ocr' | 'render'

/** Guarda com histerese: esquenta no limite, só esfria `margin` graus abaixo dele. */
export function nextHot(hot: boolean, temps: Temperatures, limits = HEAT_LIMITS) {
  const over = (value: number | null, max: number) => value !== null && value >= max
  const cool = (value: number | null, max: number) => value === null || value <= max - limits.margin
  if (!hot) return over(temps.cpu, limits.cpu) || over(temps.gpu, limits.gpu)
  return !(cool(temps.cpu, limits.cpu) && cool(temps.gpu, limits.gpu))
}

/** Descanso para um trabalho de `ms` ocupar só `share` do tempo (ciclo de trabalho). */
export function restMs(ms: number, share: number) {
  if (share >= 1 || ms <= 0) return 0
  return Math.min(MAX_REST_MS, Math.round((ms * (1 - share)) / Math.max(share, 0.05)))
}

const state = {
  usage: 100 as UsageLevel,
  guard: true,
  gpu: false,
  hot: false,
  temps: { cpu: null, gpu: null } as Temperatures,
  readAt: 0,
  reading: null as Promise<void> | null,
  read: (options: TemperatureOptions) => readTemperatures(options),
  // Tempo ocupado desde a última pausa (união dos intervalos), fim do último trabalho,
  // pausa devida (começa quando nada estiver rodando) e fim da pausa em curso.
  pace: { busy: 0, lastEnd: 0, debt: 0, until: 0 },
  slots: { ocr: 1, render: 1 } as Record<UsageKind, number>,
  running: { ocr: 0, render: 0 } as Record<UsageKind, number>,
  waiting: { ocr: [], render: [] } as Record<UsageKind, Array<() => void>>,
}

export function configureUsage(next: {
  usage?: UsageLevel
  guard?: boolean
  /** O perfil usa a placa de vídeo (só então a temperatura dela conta). */
  gpu?: boolean
  slots?: Partial<Record<UsageKind, number>>
  /** Leitura dos sensores (testes). */
  read?: (options: TemperatureOptions) => Promise<Temperatures>
}) {
  if (next.usage !== undefined) state.usage = next.usage
  if (next.guard !== undefined) state.guard = next.guard
  if (next.gpu !== undefined) state.gpu = next.gpu
  if (next.slots) Object.assign(state.slots, next.slots)
  if (next.read) {
    state.read = next.read
    state.readAt = 0
  }
  if (!state.guard) setHot(false)
  release()
}

/** Parte do tempo em que o KOMA pode trabalhar agora (1 = sem descanso). */
export function usageShare() {
  const manual = state.usage / 100
  return state.guard && state.hot ? Math.min(manual, HOT_SHARE) : manual
}

export function usageState() {
  return { usage: state.usage, guard: state.guard, hot: state.guard && state.hot, temps: state.temps }
}

function cap(kind: UsageKind) {
  return state.guard && state.hot ? Math.max(1, Math.ceil(state.slots[kind] / 2)) : Infinity
}

function release() {
  for (const kind of ['ocr', 'render'] as const)
    while (state.running[kind] < cap(kind) && state.waiting[kind].length) state.waiting[kind].shift()?.()
}

function setHot(hot: boolean) {
  if (hot === state.hot) return
  state.hot = hot
  console.info(hot ? '[KOMA] Computador quente: preparação desacelerada' : '[KOMA] Temperatura normal: preparação no ritmo normal', {
    ...state.temps,
  })
  release()
}

/** Lê os sensores se a última leitura tiver mais de 5 s. */
export function refreshHeat(now = Date.now()) {
  if (!state.guard || state.reading || now - state.readAt < READ_EVERY_MS) return state.reading || Promise.resolve()
  state.readAt = now
  state.reading = state
    .read({ gpu: state.gpu })
    .then((temps) => {
      state.temps = temps
      setHot(nextHot(state.hot, temps))
    })
    .catch(() => undefined)
    .finally(() => {
      state.reading = null
    })
  return state.reading
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Roda um trabalho pesado (ler ou desenhar uma página) dentro do limite de uso:
 * espera a pausa geral e uma vaga (menos vagas com o computador quente) e, ao terminar,
 * marca a pausa proporcional ao tempo ocupado.
 */
export async function paced<T>(kind: UsageKind, task: () => Promise<T>): Promise<T> {
  for (;;) {
    const wait = state.pace.until - performance.now()
    if (wait > 0) await sleep(wait)
    else if (state.pace.debt > 0 || state.running[kind] >= cap(kind))
      await new Promise<void>((resolve) => state.waiting[kind].push(resolve))
    else break
  }
  state.running[kind]++
  const started = performance.now()
  try {
    return await task()
  } finally {
    const ended = performance.now()
    const pace = state.pace
    pace.busy += Math.max(0, ended - Math.max(started, pace.lastEnd))
    pace.lastEnd = Math.max(pace.lastEnd, ended)
    const share = usageShare()
    const rest = restMs(pace.busy, share)
    if (share >= 1) pace.busy = 0
    else if (rest >= MIN_PAUSE_MS) {
      pace.debt += rest
      pace.busy = 0
    }
    state.running[kind]--
    if (pace.debt > 0 && state.running.ocr + state.running.render === 0) {
      pace.until = performance.now() + pace.debt
      pace.debt = 0
    }
    release()
    void refreshHeat()
  }
}
