import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { balloonInterior, renderTranslatedPage } from '../lib/server/render-translation'
import { mergeLines, mergeTileGroups } from '../lib/server/manga-ocr-node'

function canvas(width: number, height: number, paint: (x: number, y: number) => number) {
  const data = new Float32Array(width * height * 3)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = paint(x, y)
      data.set([v, v, v], (y * width + x) * 3)
    }
  return { width, height, data, left: 0, top: 0 }
}

describe('balões inteiros', () => {
  it('junta as metades de um balão cortado pela emenda entre janelas', () => {
    const top = {
      det_id: 0,
      cls_name: 'class_0',
      conf: 0.5,
      box: [40, 1000, 400, 1440] as [number, number, number, number],
      ocr_text: 'THE NEXT\nTIME YOU',
      ocr_error: '',
      lines: [
        [100, 1300, 300, 1340],
        [100, 1350, 300, 1390],
      ] as Array<[number, number, number, number]>,
      tile: 0,
    }
    const bottom = {
      ...top,
      box: [40, 1200, 400, 1430] as [number, number, number, number],
      ocr_text: 'TIME YOU\nTHINK',
      lines: [
        [100, 1352, 300, 1392],
        [100, 1400, 300, 1428],
      ] as Array<[number, number, number, number]>,
      tile: 1,
    }
    const other = {
      ...top,
      box: [40, 2000, 400, 2100] as [number, number, number, number],
      lines: [[100, 2020, 300, 2060]] as Array<[number, number, number, number]>,
      tile: 1,
    }
    const groups = mergeTileGroups([top, bottom, other])
    expect(groups.map((g) => g.length).sort()).toEqual([1, 2])
    expect(mergeLines([...top.lines, ...bottom.lines])).toHaveLength(3)
  })

  it('acha o miolo de um balão fechado e as letras dentro dele', () => {
    // Fundo cinza, balão branco com contorno preto e um "texto" preto no meio.
    const region = canvas(200, 120, (x, y) => {
      const d = ((x - 100) / 80) ** 2 + ((y - 60) / 45) ** 2
      if (d > 1.08) return 120
      if (d > 0.95) return 0
      return x > 80 && x < 120 && y > 50 && y < 70 ? 0 : 255
    })
    const interior = balloonInterior(region, [255, 255, 255], (x, y) => x > 70 && x < 130 && y > 45 && y < 75)
    expect(interior).not.toBeNull()
    expect(interior!.holes[60 * 200 + 100]).toBe(1)
    expect(interior!.outside[5 * 200 + 5]).toBe(1)
  })

  it('texto solto na página branca não é tratado como balão', () => {
    const region = canvas(200, 120, (x, y) => (x > 80 && x < 120 && y > 50 && y < 70 ? 0 : 255))
    expect(balloonInterior(region, [255, 255, 255], (x, y) => x > 70 && x < 130 && y > 45 && y < 75)).toBeNull()
  })

  it('um balão desenhado depois não traz de volta o texto apagado por outro', async () => {
    // Página preta com duas faixas de "letras" vermelhas com brilho, uma sobre a outra.
    const width = 600
    const height = 400
    const pixels = Buffer.alloc(width * height * 3)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const letter = x >= 100 && x < 500 && ((y >= 100 && y < 140) || (y >= 160 && y < 200)) && x % 20 < 12
        const glow = !letter && x >= 96 && x < 504 && ((y >= 96 && y < 144) || (y >= 156 && y < 204))
        if (letter) pixels.set([230, 230, 230], (y * width + x) * 3)
        else if (glow) pixels.set([150, 20, 20], (y * width + x) * 3)
      }
    const original = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer()
    const items = [
      {
        box: [100, 100, 500, 200] as [number, number, number, number],
        text: 'UM',
        kind: 'text' as const,
        lines: [
          [100, 100, 500, 140],
          [100, 160, 500, 200],
        ] as Array<[number, number, number, number]>,
      },
      {
        box: [100, 160, 500, 200] as [number, number, number, number],
        text: 'DOIS',
        kind: 'text' as const,
        lines: [[100, 160, 500, 200]] as Array<[number, number, number, number]>,
      },
    ]
    const rendered = await sharp(await renderTranslatedPage(original, items))
      .raw()
      .toBuffer({ resolveWithObject: true })
    // Fora do texto novo (centro), as letras e o brilho vermelho somem.
    const at = (x: number, y: number) => rendered.data[(y * width + x) * 3]
    for (const [x, y] of [
      [104, 120],
      [484, 180],
      [98, 98],
      [500, 202],
    ])
      expect(at(x, y), `${x},${y}`).toBeLessThan(60)
  })
})
