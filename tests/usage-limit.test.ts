import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SQLITE_MIGRATIONS } from '../lib/backend/shared/migrations'
import { getPerformanceMode, getUsageLimit, savePerformanceMode, saveUsageLimit } from '../lib/backend/works/performance'
import { configureUsage, nextHot, paced, refreshHeat, restMs, usageShare, usageState } from '../lib/backend/works/usage-limit'
import { readTemperatures } from '../lib/server/temperature'

describe('limite de uso', () => {
  afterEach(() => {
    configureUsage({ usage: 100, guard: true, read: async () => ({ cpu: null, gpu: null }) })
    vi.restoreAllMocks()
  })

  it('guarda com histerese: esquenta no limite e só esfria 5 graus abaixo', () => {
    // 90-94 °C é normal em notebook trabalhando: não desacelera.
    expect(nextHot(false, { cpu: 94, gpu: 70 })).toBe(false)
    expect(nextHot(false, { cpu: 95, gpu: 70 })).toBe(true)
    expect(nextHot(false, { cpu: 60, gpu: 83 })).toBe(true)
    expect(nextHot(true, { cpu: 91, gpu: 70 })).toBe(true)
    expect(nextHot(true, { cpu: 90, gpu: 79 })).toBe(true)
    expect(nextHot(true, { cpu: 90, gpu: 78 })).toBe(false)
    // Sem sensor (Windows sem administrador): só a placa conta.
    expect(nextHot(false, { cpu: null, gpu: null })).toBe(false)
    expect(nextHot(true, { cpu: null, gpu: 70 })).toBe(false)
  })

  it('ciclo de trabalho: descansa o proporcional ao tempo gasto', () => {
    expect(restMs(1200, 1)).toBe(0)
    expect(restMs(1200, 0.75)).toBe(400)
    expect(restMs(1200, 0.5)).toBe(1200)
    expect(restMs(0, 0.5)).toBe(0)
    expect(restMs(10 * 60000, 0.5)).toBe(60000)
  })

  it('quente: metade do ritmo e metade das tarefas, e volta ao normal ao esfriar', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    let temps = { cpu: 97, gpu: 70 }
    configureUsage({ usage: 100, guard: true, slots: { ocr: 4 }, read: async () => temps })
    await refreshHeat(Date.now())
    expect(usageState().hot).toBe(true)
    expect(usageShare()).toBe(0.5)
    configureUsage({ usage: 75 })
    expect(usageShare()).toBe(0.5)
    configureUsage({ usage: 100 })

    // Tarefas instantâneas não descansam (0 ms); a vaga é o que importa aqui.
    const gates: Array<() => void> = []
    let started = 0
    const tasks = Array.from({ length: 4 }, () =>
      paced('ocr', () => {
        started++
        return new Promise<void>((resolve) => gates.push(resolve))
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(started).toBe(2)

    temps = { cpu: 80, gpu: 70 }
    await refreshHeat(Date.now() + 10000)
    expect(usageState().hot).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(started).toBe(4)
    for (const open of gates) open()
    await Promise.all(tasks)
  })

  it('pausa geral: com 50%, o próximo trabalho (de qualquer tipo) espera o mesmo tempo ocupado', async () => {
    configureUsage({ usage: 50, guard: false, slots: { ocr: 4, render: 4 } })
    const work = () => new Promise<void>((resolve) => setTimeout(resolve, 300))
    // Dois trabalhos ao mesmo tempo ocupam 300 ms (união), não 600.
    await Promise.all([paced('ocr', work), paced('render', work)])
    const started = performance.now()
    await paced('render', async () => undefined)
    const waited = performance.now() - started
    expect(waited).toBeGreaterThanOrEqual(250)
    expect(waited).toBeLessThan(500)
    configureUsage({ usage: 100 })
    const free = performance.now()
    await paced('ocr', async () => undefined)
    expect(performance.now() - free).toBeLessThan(50)
  })

  it('guarda desligada ignora a temperatura; o limite manual continua valendo', async () => {
    const read = vi.fn(async () => ({ cpu: 99, gpu: 90 }))
    configureUsage({ usage: 50, guard: false, read })
    await refreshHeat(Date.now() + 20000)
    expect(read).not.toHaveBeenCalled()
    expect(usageState().hot).toBe(false)
    expect(usageShare()).toBe(0.5)
  })

  it('lê no máximo a cada 5 segundos', async () => {
    const read = vi.fn(async () => ({ cpu: 50, gpu: null }))
    configureUsage({ guard: true, read })
    const now = Date.now() + 30000
    await refreshHeat(now)
    await refreshHeat(now + 1000)
    expect(read).toHaveBeenCalledTimes(1)
    await refreshHeat(now + 5000)
    expect(read).toHaveBeenCalledTimes(2)
  })
})

describe('temperaturas', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  })
  function sysfs(nvidiaStatus: string, amdStatus = 'active') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'koma-sysfs-'))
    roots.push(root)
    const write = (file: string, value: string) => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      fs.writeFileSync(path.join(root, file), value)
    }
    write('class/hwmon/hwmon8/name', 'coretemp\n')
    write('class/hwmon/hwmon8/temp1_input', '93000\n')
    write('class/hwmon/hwmon8/temp2_input', '77000\n')
    write('class/hwmon/hwmon4/name', 'alienware_wmi\n')
    write('class/hwmon/hwmon4/temp1_input', '99000\n')
    write('class/hwmon/hwmon5/name', 'amdgpu\n')
    write('class/hwmon/hwmon5/temp1_input', '65000\n')
    write('class/hwmon/hwmon5/device/power/runtime_status', `${amdStatus}\n`)
    write('bus/pci/devices/0000:00:02.0/vendor', '0x8086\n')
    write('bus/pci/devices/0000:00:02.0/class', '0x030000\n')
    write('bus/pci/devices/0000:01:00.0/vendor', '0x10de\n')
    write('bus/pci/devices/0000:01:00.0/class', '0x030000\n')
    write('bus/pci/devices/0000:01:00.0/power/runtime_status', `${nvidiaStatus}\n`)
    write('bus/pci/devices/0000:01:00.1/vendor', '0x10de\n')
    write('bus/pci/devices/0000:01:00.1/class', '0x040300\n')
    return root
  }

  it('não acorda a NVIDIA suspensa nem lê a AMD suspensa', async () => {
    const nvidiaSmi = vi.fn(async () => 72)
    expect(await readTemperatures({ gpu: true, root: sysfs('suspended', 'suspended'), platform: 'linux', nvidiaSmi })).toEqual({
      cpu: 93,
      gpu: null,
    })
    expect(nvidiaSmi).not.toHaveBeenCalled()
  })

  it('lê a placa acordada e só quando o perfil a usa', async () => {
    const nvidiaSmi = vi.fn(async () => 72)
    const root = sysfs('active')
    expect(await readTemperatures({ gpu: true, root, platform: 'linux', nvidiaSmi })).toEqual({ cpu: 93, gpu: 72 })
    expect(await readTemperatures({ gpu: false, root, platform: 'linux', nvidiaSmi })).toEqual({ cpu: 93, gpu: null })
    expect(nvidiaSmi).toHaveBeenCalledTimes(1)
  })

  it('Windows: só a placa (a CPU exige administrador)', async () => {
    expect(await readTemperatures({ gpu: true, platform: 'win32', nvidiaSmi: async () => 70 })).toEqual({ cpu: null, gpu: 70 })
    expect(await readTemperatures({ gpu: false, platform: 'win32', nvidiaSmi: async () => 70 })).toEqual({ cpu: null, gpu: null })
  })
})

describe('preferência do limite de uso', () => {
  it('padrão 100% com a guarda ligada; salva sem perder o perfil', () => {
    const db = new Database(':memory:')
    for (const migration of SQLITE_MIGRATIONS) db.exec(migration.up)
    expect(getUsageLimit(db)).toEqual({ usage: 100, guard: true })
    savePerformanceMode(db, 'maximo')
    expect(saveUsageLimit(db, { usage: 75 })).toEqual({ usage: 75, guard: true })
    expect(saveUsageLimit(db, { guard: false })).toEqual({ usage: 75, guard: false })
    expect(getPerformanceMode(db)).toBe('maximo')
    savePerformanceMode(db, 'leve')
    expect(getUsageLimit(db)).toEqual({ usage: 75, guard: false })
    expect(() => saveUsageLimit(db, { usage: 30 })).toThrow()
    expect(() => saveUsageLimit(db, { guard: 'sim' })).toThrow()
  })
})
