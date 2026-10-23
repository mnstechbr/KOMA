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
