import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
vi.mock('server-only', () => ({}))

describe('OCR em processo separado', () => {
  it('manda os pedidos ao worker e devolve o resultado; o apagamento volta para o mesmo buffer', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koma-ml-'))
    const file = path.join(dir, 'ml-worker.mjs')
    fs.writeFileSync(
      file,
      `import { parentPort, threadId } from 'node:worker_threads'
parentPort.on('message', ({ id, method, args }) => {
  if (method === 'extract') parentPort.postMessage({ id, value: { detections: [{ ocr_text: 'bytes:' + args[0].length + ':' + args[1], thread: threadId }] } })
  else if (method === 'inpaint') { args[0].fill(threadId); parentPort.postMessage({ id, value: { ok: true, data: args[0] } }) }
  else if (method === 'probe') parentPort.postMessage({ id, error: 'sem placa' })
  else parentPort.postMessage({ id, value: true })
})`,
    )
    vi.stubEnv('KOMA_ML_WORKER', file)
    const ml = await import('../lib/server/ml')
    expect(ml.separateMl()).toBe(true)
    const detection = (await ml.extractText(Buffer.from('abc'), 'en')).detections[0] as unknown as { ocr_text: string; thread: number }
    expect(detection.ocr_text).toBe('bytes:3:en')
    const data = new Float32Array(4)
    expect(await ml.inpaintRegion(data, 2, 2, new Uint8Array(4))).toBe(true)
    // O desenho tem worker próprio: não espera o OCR nem disputa a thread dele.
    expect(data[0]).toBeGreaterThan(0)
    expect(data[0]).not.toBe(detection.thread)
    expect([...data]).toEqual([data[0], data[0], data[0], data[0]])
    await ml.configureMl({ device: 'cpu', threads: 2, drawThreads: 3 })
    await expect(ml.probeGpuDevice()).rejects.toThrow('sem placa')
    vi.unstubAllEnvs()
  })
})

describe('modelos liberados com a fila parada', () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  type Reply = { thread: number; configs: number }

  it('não libera com pedido em andamento nem com a fila ocupada; libera depois do tempo e recria com a mesma configuração', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koma-ml-idle-'))
    const file = path.join(dir, 'ml-worker.mjs')
    fs.writeFileSync(
      file,
      `import { parentPort, threadId } from 'node:worker_threads'
let configs = 0
parentPort.on('message', ({ id, method, args }) => {
  if (method === 'configure') configs++
  const reply = () => parentPort.postMessage({ id, value: method === 'extract' ? { detections: [{ thread: threadId, configs }] } : true })
  if (method === 'extract' && args[1] === 'lento') setTimeout(reply, 400)
  else reply()
})`,
    )
    vi.stubEnv('KOMA_ML_WORKER', file)
    vi.stubEnv('KOMA_ML_IDLE_MS', '150')
    delete (globalThis as { __komaMl2?: unknown }).__komaMl2
    vi.resetModules()
    const ml = await import('../lib/server/ml')
    const read = async (language: string) => (await ml.extractText(Buffer.from('a'), language)).detections[0] as unknown as Reply
    await ml.configureMl({ device: 'cpu', threads: 2 })
    const first = await read('en')
    expect(first.configs).toBe(1)
    expect(ml.mlWorkers().ocr).toBe(true)

    // Pedido que demora mais que o tempo de folga: o worker continua.
    const slow = read('lento')
    await sleep(250)
    expect(ml.mlWorkers().ocr).toBe(true)
    expect((await slow).thread).toBe(first.thread)

    // Capítulo em preparo na fila: continua mesmo sem pedido.
    let busy = true
    ml.keepMlWhile(() => busy)
    await sleep(400)
    expect(ml.mlWorkers().ocr).toBe(true)

    // Fila parada: libera.
    busy = false
    await sleep(400)
    expect(ml.mlWorkers().ocr).toBe(false)

    // Próximo pedido cria outro worker, que recebe a configuração de novo.
    const again = await read('en')
    expect(again.thread).not.toBe(first.thread)
    expect(again.configs).toBe(1)
    expect(ml.mlWorkers().ocr).toBe(true)
    ml.keepMlWhile(null)
    vi.unstubAllEnvs()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
