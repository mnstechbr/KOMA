import type { OcrDetection } from '../sections/sections.types'
import { similarity } from './render'

/**
 * Marca d'água do site repetida nas páginas do capítulo ("LikeManga.ink" no canto
 * de cima), que o OCR lê em pedaços diferentes em cada página ("IKEM", "laNGA.I",
 * "Ink"). Sozinho, um pedaço parece palavra e seria traduzido ("Tinta"). Aqui ele
 * é reconhecido pela repetição: texto curto, colado na borda de cima ou de baixo,
 * na mesma coluna e parecido com o de outras páginas.
 */
// Pedaços do mesmo endereço: parecidos, ou com 4 letras seguidas em comum ("IKEM" e "IKEMANGA").
function alike(a: string, b: string) {
  if (similarity(a, b) >= 0.5) return true
  const [x, y] = [a.toUpperCase(), b.toUpperCase()]
  for (let i = 0; i + 4 <= x.length; i++) if (y.includes(x.slice(i, i + 4))) return true
  return false
}

export function repeatedMarks(pages: Array<{ height: number; detections: OcrDetection[] }>) {
  const margin = (height: number) => Math.max(60, height * 0.04)
  const candidates = pages.flatMap((page, index) =>
    page.detections.flatMap((detection) => {
      const text = (detection.ocr_text || '').replace(/[^\p{L}\p{N}]/gu, '')
      if (!detection.box || !text || text.length > 16) return []
      const edge =
        detection.box[1] < margin(page.height) ? 'top' : page.height && detection.box[3] > page.height - margin(page.height) ? 'bottom' : ''
      return edge ? [{ detection, index, text, edge, center: (detection.box[0] + detection.box[2]) / 2 }] : []
    }),
  )
  const marks = new Set<OcrDetection>()
  for (const item of candidates) {
    // Parecido com o de pelo menos duas outras páginas, na mesma borda e quase na mesma coluna.
    const pagesAlike = new Set(
      candidates
        .filter(
          (other) =>
            other.index !== item.index &&
            other.edge === item.edge &&
            Math.abs(other.center - item.center) <= 100 &&
            alike(other.text, item.text),
        )
        .map((other) => other.index),
    )
    if (pagesAlike.size >= 2) marks.add(item.detection)
  }
  return marks
}
