import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { harvestNames } from '../lib/backend/works/names'
import { splitBalloons } from '../lib/backend/works/split-balloons'
import { repeatedMarks } from '../lib/backend/works/watermark'
import { readSceneReply } from '../lib/backend/kpassword/translation'
import { fitText, textWidth } from '../lib/server/render-translation'

describe('qualidade da tradução', () => {
  it('guarda como nome a palavra que ficou igual na tradução', () => {
    const names = harvestNames([
      { source: 'LOGAN MCLAIN HAD KILLED THE KING.', translation: 'Logan McLain havia matado o rei.' },
      { source: 'RADIOS, MASTER OF THE EARTH TOWER', translation: 'Radios, mestre da Torre da Terra' },
      { source: 'HAAAH...', translation: 'HAAAH...' },
      { source: 'THE CAPITAL IS FINAL', translation: 'A capital é final' },
      { source: "HUMAN-FACED SPIDER! IT'S MOK-HWA'S", translation: 'Aranha de rosto humano! É do Mok-Hwa' },
    ])
    expect([...names.keys()].sort()).toEqual(['Logan', 'McLain', 'Mok-Hwa', 'Radios'])
  })

  it('aceita item pulado (crédito ou lixo do OCR) sem texto', () => {
    const reply = {
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              translations: [
                { id: 0, text: 'Olá', needsReview: false },
                { id: 1, text: '', needsReview: false, skip: true },
              ],
            }),
          },
        },
      ],
    }
    const result = readSceneReply(reply, [0, 1])
    expect(result.skipped).toEqual([1])
    expect(result.lines.map((line) => line.text)).toEqual(['Olá', ''])
    // Texto vazio sem "skip" continua inválido.
    const broken = {
      choices: [
        { finish_reason: 'stop', message: { content: JSON.stringify({ translations: [{ id: 0, text: '', needsReview: false }] }) } },
      ],
    }
    expect(() => readSceneReply(broken, [0])).toThrow()
  })

  it('reconhece balão cortado entre duas imagens', () => {
    const top = { box: [300, 1500, 620, 1700] as [number, number, number, number], ocr_text: 'HAAAH... I' }
    const other = { box: [10, 200, 300, 400] as [number, number, number, number], ocr_text: 'HM?' }
    const bottom = { box: [320, 0, 610, 60] as [number, number, number, number], ocr_text: 'I' }
    expect(splitBalloons([top, other], 1703, [bottom])).toEqual([[top, bottom]])
    expect(splitBalloons([other], 1703, [bottom])).toEqual([])
    // A linha cortada não foi achada: a última linha lida para a menos de meia linha do corte.
    const near = {
      box: [241, 1127, 564, 1234] as [number, number, number, number],
      ocr_text: 'IF YOU',
      lines: [[241, 1127, 564, 1234]] as Array<[number, number, number, number]>,
    }
    const rest = { box: [177, 0, 631, 183] as [number, number, number, number], ocr_text: 'CAN STOP\nTHEM...' }
    expect(splitBalloons([near], 1250, [rest])).toEqual([[near, rest]])
    expect(
      splitBalloons(
        [
          {
            ...near,
            box: [241, 1027, 564, 1134] as [number, number, number, number],
            lines: [[241, 1027, 564, 1134]] as Array<[number, number, number, number]>,
          },
        ],
        1250,
        [rest],
      ),
    ).toEqual([])
  })

  it('encaixa o texto na largura real de um balão oval', () => {
    const text = 'Isso deu início à primeira guerra civil, durante a qual morreram dois dos super-humanos do reino.'
    // Elipse de 300 × 200: a largura livre cai perto do topo e da base.
    const room = (from: number, to: number) => {
      const edge = Math.max(Math.abs(from), Math.abs(to))
      return edge >= 100 ? 0 : 300 * Math.sqrt(1 - (edge / 100) ** 2) * 0.9
    }
    const fit = fitText(text, 270, 180, 40, room)
    const start = -(fit.lines.length * fit.lineHeight) / 2
    fit.lines.forEach((line, i) =>
      expect(textWidth(line, fit.size)).toBeLessThanOrEqual(room(start + i * fit.lineHeight, start + (i + 1) * fit.lineHeight)),
    )
  })
})

describe('respostas de modelos diferentes', () => {
  const reply = (translations: unknown[]) => ({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations }) } }],
  })
  it('aceita campos opcionais em formatos variados', () => {
    const result = readSceneReply(
      reply([
        { id: '0', text: 'Olá' },
        { id: 1, skip: true },
        { id: 2, text: null, skip: 'true', needsReview: false },
        { id: 3, text: 'Oi', needsReview: true },
      ]),
      [0, 1, 2, 3],
    )
    expect(result.lines.map((line) => line.text)).toEqual(['Olá', '', '', 'Oi'])
    expect(result.skipped).toEqual([1, 2])
    expect(result.flagged).toEqual([3])
  })
})

describe('revisão com fala em branco', () => {
  it('aceita branco só na revisão e marca a fala', () => {
    const reply = {
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              translations: [
                { id: 0, text: 'Olá' },
                { id: 1, text: '' },
              ],
            }),
          },
        },
      ],
    }
    expect(readSceneReply(reply, [0, 1], true).blank).toEqual([1])
    expect(() => readSceneReply(reply, [0, 1])).toThrow()
  })
})

describe("marca d'água repetida", () => {
  it('reconhece os pedaços do endereço no canto e não as falas cortadas na borda', () => {
    const at = (box: [number, number, number, number], ocr_text: string) => ({ box, ocr_text })
    const pages = [
      { height: 2000, detections: [at([569, 5, 675, 49], 'laNGA.I'), at([300, 1950, 500, 2000], "WE'RE")] },
      { height: 2000, detections: [at([507, 3, 666, 54], 'KEMANGA'), at([664, 5, 720, 49], 'Ink'), at([280, 0, 520, 60], 'FALLING')] },
      {
        height: 2000,
        detections: [at([498, 0, 676, 50], 'IKEMANGA.I'), at([663, 8, 714, 45], 'Unk'), at([310, 1940, 490, 2000], 'HERE!')],
      },
      { height: 2000, detections: [at([660, 6, 716, 47], 'TNK'), at([290, 0, 510, 70], 'NOW')] },
    ]
    const marks = repeatedMarks(pages)
    expect([...marks].map((item) => item.ocr_text).sort()).toEqual(['IKEMANGA.I', 'Ink', 'KEMANGA', 'TNK', 'Unk', 'laNGA.I'])
  })
})
