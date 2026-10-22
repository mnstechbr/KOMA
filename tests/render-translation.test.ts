import { describe, expect, it, vi } from 'vitest'
vi.mock('onnxruntime-node', () => ({}))
vi.mock('server-only', () => ({}))
import sharp from 'sharp'
import { fitText, renderTranslatedPage, textWidth } from '../lib/server/render-translation'
import { groupLines, readingRows } from '../lib/server/text-detect'

describe('página traduzida desenhada', () => {
  it('encaixa o texto na área disponível com quebra de linhas', () => {
    const fit = fitText('Era um lugar que aprimorava suas artes marciais', 200, 120)
    expect(fit.lines.length).toBeGreaterThan(1)
    expect(fit.lines.length * fit.lineHeight).toBeLessThanOrEqual(120)
    expect(Math.max(...fit.lines.map((line) => textWidth(line, fit.size)))).toBeLessThanOrEqual(200)
    // Diminui a fonte em vez de quebrar a palavra no meio.
    const narrow = fitText('INDEPENDENTEMENTE DOS RESULTADOS', 150, 200)
    expect(narrow.lines.every((line) => !line.endsWith('-'))).toBe(true)
    expect(narrow.lines).toContain('INDEPENDENTEMENTE')
  })

  it('agrupa linhas da mesma narração e separa blocos distantes', () => {
    const line = (y: number, x = 100) => ({ x1: x, y1: y, x2: x + 300, y2: y + 30, score: 0.9 })
    const blocks = groupLines([line(0), line(34), line(68), line(600)])
    expect(blocks.map((block) => block.lines.length).sort()).toEqual([1, 3])
  })

  it('junta palavras da mesma fileira e lê na ordem certa', () => {
    const box = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2, score: 1 })
    // "I HAD" + "MORE" / "THAN" + "ENOUGH" / "TIME." (o detector separou as palavras).
    const words = [
      box(125, 402, 387, 493),
      box(395, 402, 665, 491),
      box(100, 500, 323, 587),
      box(319, 499, 701, 586),
      box(282, 591, 516, 688),
    ]
    expect(groupLines(words)).toHaveLength(1)
    // "TO" menor e um pouco abaixo de "UTTERLY" vem antes dele.
    const rows = readingRows([box(305, 1, 594, 107), box(215, 6, 315, 101), box(278, 101, 518, 222)])
    expect(rows.map((row) => row.map((line) => line.x1))).toEqual([[215, 305], [278]])
    // Linhas empilhadas com caixas que se sobrepõem na vertical continuam em fileiras separadas.
    expect(readingRows([box(100, 0, 400, 60), box(120, 45, 380, 105)])).toHaveLength(2)
    // Efeito sonoro grande ao lado da fala não entra na fileira dela.
    expect(groupLines([box(81, 916, 314, 959), box(344, 860, 536, 1051)])).toHaveLength(2)
  })

  it('apaga o texto do balão branco e escreve a tradução no lugar', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#6a8"/><ellipse cx="200" cy="150" rx="160" ry="110" fill="#fff" stroke="#000" stroke-width="4"/><text x="200" y="155" text-anchor="middle" font-size="30" font-family="sans-serif">HELLO THERE</text></svg>`
    const original = await sharp(Buffer.from(svg)).png().toBuffer()
    const out = await renderTranslatedPage(original, [
      { box: [40, 40, 360, 260], kind: 'balloon', text: 'Olá', source: 'HELLO THERE', lines: [[105, 128, 295, 162]] },
    ])
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([400, 300])
    // Fora da área da nova palavra, onde estava "HELLO", o balão volta a ser branco.
    const pixel = (x: number, y: number) => data[(y * info.width + x) * info.channels]
    expect(pixel(120, 145)).toBeGreaterThan(230)
    expect(pixel(10, 10)).toBeLessThan(200)
  })
})

describe('atualização de páginas já traduzidas', () => {
  it('reaproveita traduções de balões já existentes e só traduz o texto novo', async () => {
    const Database = (await import('better-sqlite3')).default
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const { upgradeWorkPage } = await import('../lib/backend/works/render')
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE section_images(id INTEGER PRIMARY KEY, original_path TEXT, translated_path TEXT);
      CREATE TABLE section_image_ocr_items(section_image_id INTEGER, x1 INTEGER, y1 INTEGER, x2 INTEGER, y2 INTEGER, ocr_text TEXT, translated_text TEXT);
      CREATE TABLE work_pages(id INTEGER PRIMARY KEY, chapter_id INTEGER, state TEXT, message TEXT, ocr_json TEXT, upgrade_pending INTEGER, render_stale INTEGER DEFAULT 0);
      CREATE TABLE work_chapters(id INTEGER PRIMARY KEY, state TEXT, message TEXT);`)
    const file = path.join(os.tmpdir(), `koma-upgrade-${process.pid}.png`)
    fs.writeFileSync(file, Buffer.from('x'))
    db.prepare("INSERT INTO section_images VALUES(1,?, 'old.jpg')").run(file)
    db.prepare("INSERT INTO section_image_ocr_items VALUES(1,10,10,100,100,'HELLO','Olá'),(1,10,200,100,260,'GARBLE','Lixo')").run()
    db.prepare("INSERT INTO work_pages VALUES(5,7,'review','x','[]',1,0)").run()
    db.prepare("INSERT INTO work_chapters VALUES(7,'partial','x')").run()
    const translate = vi.fn(async (texts: string[]) => ({ translations: texts.map(() => 'Uma seita') }))
    const replace = vi.fn()
    const recognize = async () => [
      { det_id: 0, box: [12, 12, 98, 98] as [number, number, number, number], ocr_text: 'HELLO' },
      { det_id: 1, box: [12, 202, 98, 258] as [number, number, number, number], ocr_text: 'GUARDS!!' },
      { det_id: 2, cls_name: 'text', box: [10, 300, 200, 340] as [number, number, number, number], ocr_text: 'A SECT' },
    ]
    // Mesmo texto: reaproveita. Texto diferente no mesmo lugar (OCR antigo errado): traduz de novo.
    expect(await upgradeWorkPage(db, { id: 5, image_id: 1, language: 'en' }, recognize, translate, replace)).toBe(2)
    expect(translate).toHaveBeenCalledWith(['GUARDS!!', 'A SECT'], 'en')
    expect([...replace.mock.calls[0][2].entries()]).toEqual([
      [0, 'Olá'],
      [1, 'Uma seita'],
      [2, 'Uma seita'],
    ])
    expect(db.prepare('SELECT state,upgrade_pending FROM work_pages').get()).toEqual({ state: 'ready', upgrade_pending: 0 })
    expect(db.prepare('SELECT state FROM work_chapters').get()).toEqual({ state: 'ready' })
    // A página traduzida antiga continua até a nova ser desenhada.
    expect(db.prepare('SELECT translated_path FROM section_images').get()).toEqual({ translated_path: 'old.jpg' })
    expect(db.prepare('SELECT render_stale FROM work_pages').get()).toEqual({ render_stale: 1 })
    fs.rmSync(file)
  })
})

describe('falas duplicadas no mesmo balão', () => {
  it('mantém só a leitura mais completa quando duas falas cobrem o mesmo texto', async () => {
    const { dedupeDetections } = await import('../lib/server/manga-ocr-node')
    const kept = dedupeDetections([
      { box: [100, 100, 400, 300], ocr_text: 'POISON TO\nPALACE BA', lines: [[100, 120, 260, 280]] },
      { box: [90, 100, 420, 310], ocr_text: 'THEY EVEN HANDED POISON TO THE SWORD PALACE', lines: [[110, 110, 410, 300]] },
      { box: [90, 600, 420, 700], ocr_text: 'OUTRO BALÃO', lines: [[110, 610, 410, 690]] },
    ] as Array<{ box: [number, number, number, number]; ocr_text: string; lines: Array<[number, number, number, number]> }>)
    expect(kept.map((item) => item.ocr_text)).toEqual(['THEY EVEN HANDED POISON TO THE SWORD PALACE', 'OUTRO BALÃO'])
  })
})
