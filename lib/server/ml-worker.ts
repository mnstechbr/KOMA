// Processo separado (worker thread) para o OCR e o apagamento do texto. Carregar
// um modelo ONNX trava a thread que o carrega por segundos; aqui isso não segura
// as telas do app. Recebe pedidos do lib/server/ml.ts e devolve as respostas.
import { parentPort } from 'node:worker_threads'
import { configureOcr, extractTextBoxesNode, probeGpu, recognizeImageTextNode } from './manga-ocr-node'
import { configureInpaint, inpaintAvailable, lamaInpaint, textMask } from './inpaint'
import { renderTranslatedPage, type RenderItem } from './render-translation'
import { setPromoNames } from '@/lib/promo-text'

type Request = { id: number; method: string; args: unknown[] }
const handlers: Record<string, (...args: never[]) => unknown> = {
  configure: (ocr: { device: 'cpu' | 'webgpu'; threads: number }) => { configureOcr(ocr); configureInpaint(ocr.device); return true },
  extract: (bytes: Uint8Array, language: string) => extractTextBoxesNode(Buffer.from(bytes), language),
  recognize: (bytes: Uint8Array, timeout: number, language: string) => recognizeImageTextNode(Buffer.from(bytes), timeout, language),
  probe: () => probeGpu(),
  promo: (names: string[]) => { setPromoNames(names); return true },
  // Desenho da página traduzida: os laços de pixels também ficam fora da thread das telas.
  render: async (bytes: Uint8Array, items: RenderItem[]) => {
    const original = Buffer.from(bytes)
    let mask: Promise<Uint8Array | null> | null = null
    const models = inpaintAvailable() ? { mask: () => (mask ||= textMask(original).catch(() => null)), inpaint: (data: Float32Array, width: number, height: number, holes: Uint8Array) => lamaInpaint(data, width, height, holes).catch(() => false) } : undefined
    return new Uint8Array(await renderTranslatedPage(original, items, undefined, models))
  },
  mask: (bytes: Uint8Array) => textMask(Buffer.from(bytes)),
  inpaint: async (data: Float32Array, width: number, height: number, mask: Uint8Array) => ({ ok: await lamaInpaint(data, width, height, mask), data }),
}

parentPort?.on('message', async ({ id, method, args }: Request) => {
  try {
    const value = await handlers[method](...(args as never[]))
    parentPort!.postMessage({ id, value })
  } catch (error) {
    parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
})
