import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { mergeSplitBalloons } from '../lib/server/manga-ocr-node'

describe('união de balões cortados pelo detector', () => {
  it('une metades lado a lado do mesmo balão e preserva balões separados', () => {
    const boxes = [
      { x1: 96, y1: 187, x2: 375, y2: 556, conf: 0.77 },
      { x1: 344, y1: 170, x2: 635, y2: 562, conf: 0.83 },
      { x1: 110, y1: 2162, x2: 475, y2: 2429, conf: 0.83 },
      { x1: 500, y1: 2162, x2: 700, y2: 2429, conf: 0.8 },
    ]
    expect(mergeSplitBalloons(boxes)).toEqual([
      { x1: 96, y1: 170, x2: 635, y2: 562, conf: 0.83 },
      { x1: 110, y1: 2162, x2: 475, y2: 2429, conf: 0.83 },
      { x1: 500, y1: 2162, x2: 700, y2: 2429, conf: 0.8 },
    ])
  })
  it('não une caixas que só encostam numa quina', () => {
    const boxes = [{ x1: 0, y1: 0, x2: 100, y2: 100, conf: 0.9 }, { x1: 90, y1: 90, x2: 200, y2: 200, conf: 0.9 }]
    expect(mergeSplitBalloons(boxes)).toHaveLength(2)
  })
})
