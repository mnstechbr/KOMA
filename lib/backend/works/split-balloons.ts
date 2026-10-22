import fs from 'node:fs'
import type Database from 'better-sqlite3'
import sharp from 'sharp'
import type { OcrDetection } from '../sections/sections.types'

// O site às vezes corta o capítulo em arquivos no meio de um balão. A metade de
// cima encosta no fim de uma imagem e a de baixo no começo da seguinte.
const EDGE = 8
type Line = [number, number, number, number]
const horizontalOverlap = (a: number[], b: number[]) =>
  Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) / Math.max(1, Math.min(a[2] - a[0], b[2] - b[0]))
/** A fala encosta no fim da imagem: a última linha (não a caixa do detector, que pode sobrar) chega a menos de meia linha do corte. */
export function touchesBottom(item: OcrDetection, height: number) {
  if (!item.box) return false
  const last = [...(item.lines || [])].sort((a, b) => b[3] - a[3])[0]
  return last ? last[3] >= height - Math.max(EDGE, (last[3] - last[1]) * 0.4) : item.box[3] >= height - EDGE
}
/** A fala encosta no começo da imagem. */
export function touchesTop(item: OcrDetection) {
  if (!item.box) return false
  const first = [...(item.lines || [])].sort((a, b) => a[1] - b[1])[0]
  return first ? first[1] <= Math.max(EDGE, (first[3] - first[1]) * 0.4) : item.box[1] <= EDGE
}
export function splitBalloons(upper: OcrDetection[], upperHeight: number, lower: OcrDetection[]) {
  const pairs: Array<[OcrDetection, OcrDetection]> = []
  const used = new Set<OcrDetection>()
  for (const top of upper) {
    if (!top.box) continue
    // Metades já juntadas antes ficam juntas.
    if (!top.continued && !touchesBottom(top, upperHeight)) continue
    const bottom = lower
      .filter(
        (item) =>
          item.box &&
          (top.continued ? item.continues : touchesTop(item)) &&
          !used.has(item) &&
          horizontalOverlap(top.box!, item.box) >= 0.4,
      )
      .sort((a, b) => horizontalOverlap(top.box!, b.box!) - horizontalOverlap(top.box!, a.box!))[0]
    if (bottom) {
      used.add(bottom)
      pairs.push([top, bottom])
    }
  }
  return pairs
}

type Ocr = (bytes: Buffer, language: string) => Promise<{ detections?: OcrDetection[] }>
type Translate = (texts: string[], source: string) => Promise<{ translations: string[] }>
const readable = (detection: OcrDetection) => !detection.ocr_error && Boolean(detection.ocr_text?.trim())

/**
 * Lê de novo, numa imagem só, cada fala cortada entre duas imagens vizinhas do
 * capítulo: as duas metades coladas dão o texto inteiro (sem as meias letras lidas
 * como lixo) e as linhas que atravessam o corte. A tradução é uma só, desenhada
 * nas duas imagens. Vale para a primeira leitura e para a releitura das páginas.
 */
export async function joinSplitBalloons(database: Database.Database, chapterId: number, language: string, ocr: Ocr, translate: Translate) {
  const pages = database
    .prepare(
      'SELECT p.id, p.page_index, p.ocr_json, i.id AS image_id, i.original_path FROM work_pages p JOIN section_images i ON i.id=p.image_id WHERE p.chapter_id=? AND p.ocr_json IS NOT NULL ORDER BY p.page_index',
    )
    .all(chapterId) as Array<{ id: number; page_index: number; ocr_json: string; image_id: number; original_path: string }>
  const found: Array<{
    upper: (typeof pages)[number]
    lower: (typeof pages)[number]
    top: OcrDetection
    bottom: OcrDetection
    text: string
  }> = []
  const added: Array<{ page: (typeof pages)[number]; detection: OcrDetection }> = []
  const parsed = new Map(pages.map((page) => [page.id, JSON.parse(page.ocr_json || '[]') as OcrDetection[]]))
  for (let index = 1; index < pages.length; index++) {
    const upper = pages[index - 1]
    const lower = pages[index]
    if (lower.page_index !== upper.page_index + 1 || !fs.existsSync(upper.original_path) || !fs.existsSync(lower.original_path)) continue
    const above = await sharp(upper.original_path).metadata()
    const below = await sharp(lower.original_path).metadata()
    const upperItems = parsed.get(upper.id)!
    const lowerItems = parsed.get(lower.id)!
    const pairs: Array<[OcrDetection, OcrDetection, 'upper' | 'lower' | null]> = splitBalloons(
      upperItems.filter((item) => readable(item) && !item.continued),
      above.height!,
      lowerItems.filter((item) => readable(item) && !item.continues),
    ).map(([a, b]) => [a, b, null])
    // A outra metade não foi achada pela leitura (só o topo das letras ficou na
    // imagem de cima: "PHOENIX, ARE YOU"): a imagem colada mostra se há texto ali.
    const paired = new Set(pairs.flatMap(([a, b]) => [a, b]))
    const half = (item: OcrDetection, box: [number, number, number, number]): OcrDetection => ({
      det_id: 0,
      cls_name: item.cls_name,
      conf: item.conf,
      box,
      ocr_text: '',
      ocr_error: '',
      lines: [],
    })
    for (const item of lowerItems)
      if (readable(item) && !item.continues && !paired.has(item) && touchesTop(item)) {
        const lineHeight = Math.max(20, ...(item.lines || []).map((line) => line[3] - line[1]))
        pairs.push([
          half(item, [item.box![0], Math.max(0, above.height! - Math.round(lineHeight * 1.2)), item.box![2], above.height!]),
          item,
          'upper',
        ])
      }
    for (const item of upperItems)
      if (readable(item) && !item.continued && !paired.has(item) && touchesBottom(item, above.height!)) {
        const lineHeight = Math.max(20, ...(item.lines || []).map((line) => line[3] - line[1]))
        pairs.push([item, half(item, [item.box![0], 0, item.box![2], Math.min(below.height!, Math.round(lineHeight * 1.2))]), 'lower'])
      }
    for (const [top, bottom, missing] of pairs) {
      const margin = 20
      const height = above.height!
      const x1 = Math.max(0, Math.min(top.box![0], bottom.box![0]) - margin)
      const x2 = Math.min(above.width!, below.width!, Math.max(top.box![2], bottom.box![2]) + margin)
      const y1 = Math.max(0, top.box![1] - margin)
      const y2 = Math.min(below.height!, bottom.box![3] + margin)
      const width = x2 - x1
      const parts = await Promise.all([
        sharp(upper.original_path)
          .extract({ left: x1, top: y1, width, height: height - y1 })
          .png()
          .toBuffer(),
        sharp(lower.original_path).extract({ left: x1, top: 0, width, height: y2 }).png().toBuffer(),
      ])
      const stitched = await sharp({ create: { width, height: height - y1 + y2, channels: 3, background: '#ffffff' } })
        .composite([
          { input: parts[0], top: 0, left: 0 },
          { input: parts[1], top: height - y1, left: 0 },
        ])
        .png()
        .toBuffer()
      // Só o que atravessa o corte é a fala partida; outro balão que entrou no recorte fica de fora.
      const seam = height - y1
      const read = ((await ocr(stitched, language)).detections || [])
        .filter(readable)
        .filter((item) => (item.lines || []).some(([, a, , b]) => a <= seam + (b - a) * 0.6 && b >= seam - (b - a) * 0.6))
        .sort((a, b) => (a.box?.[1] || 0) - (b.box?.[1] || 0))
      const text =
        read.map((item) => item.ocr_text!.trim()).join('\n') ||
        [top.ocr_text, bottom.ocr_text]
          .map((value) => (value || '').trim())
          .filter(Boolean)
          .join('\n')
      // Linhas lidas na imagem colada, de volta às coordenadas de cada metade.
      const lines = read.flatMap((item) => item.lines || []).map(([a, b, c, d]): Line => [a + x1, b + y1, c + x1, d + y1])
      const upperLines: Line[] = lines.filter((line) => line[1] < height).map(([a, b, c, d]): Line => [a, b, c, Math.min(d, height)])
      const lowerLines: Line[] = lines
        .filter((line) => line[3] > height)
        .map(([a, b, c, d]): Line => [a, Math.max(0, b - height), c, d - height])
      // A metade que faltava só existe se a imagem colada tiver letra do lado dela (mais que um fio).
      let realUpper = upperLines.filter((line) => line[3] - line[1] >= 6)
      let realLower = lowerLines.filter((line) => line[3] - line[1] >= 6)
      // Letra estilizada que o leitor não reconhece nem colada: a linha cortada é mais
      // baixa que as outras da fala; o que falta dela está do outro lado do corte.
      if (missing && !read.length) {
        const known = missing === 'upper' ? bottom : top
        const sorted = [...(known.lines || [])].sort((a, b) => (missing === 'upper' ? a[1] - b[1] : b[3] - a[3]))
        const cut = sorted[0]
        const heights = sorted
          .slice(1)
          .map((line) => line[3] - line[1])
          .filter((value) => cut && value >= (cut[3] - cut[1]) * 0.5)
          .sort((a, b) => a - b)
        const full = heights.length ? heights[Math.floor(heights.length / 2)] : 0
        // No máximo quase a altura do que sobrou da linha: uma letra não é cortada em mais que isso.
        const lack = cut ? Math.min(full - (cut[3] - cut[1]), cut[3] - cut[1]) + 6 : 0
        if (cut && lack >= 14) {
          if (missing === 'upper') {
            realUpper = [[cut[0], height - lack, cut[2], height]]
            upperLines.push(...realUpper)
          } else {
            realLower = [[cut[0], 0, cut[2], lack]]
            lowerLines.push(...realLower)
          }
        }
      }
      if (missing === 'upper' && !realUpper.length) continue
      if (missing === 'lower' && !realLower.length) continue
      if (missing) {
        const created = missing === 'upper' ? top : bottom
        const list = missing === 'upper' ? upperItems : lowerItems
        const own = missing === 'upper' ? realUpper : realLower
        created.det_id = Math.max(-1, ...list.map((entry) => entry.det_id ?? -1)) + 1
        created.box = [
          Math.min(...own.map((line) => line[0])),
          Math.min(...own.map((line) => line[1])),
          Math.max(...own.map((line) => line[2])),
          Math.max(...own.map((line) => line[3])),
        ]
        list.push(created)
        added.push({ page: missing === 'upper' ? upper : lower, detection: created })
      }
      if (upperLines.length) top.lines = upperLines
      if (lowerLines.length) bottom.lines = lowerLines
      top.box = [top.box![0], top.box![1], top.box![2], height]
      bottom.box = [bottom.box![0], 0, bottom.box![2], bottom.box![3]]
      top.continued = true
      bottom.continues = true
      found.push({ upper, lower, top, bottom, text })
    }
  }
  if (!found.length) return 0
  // As outras falas das duas imagens vão junto como contexto ("READ-" sozinho vira "lendo";
  // depois de "I'M TRYING!" é "READY"). Só as falas juntadas usam a resposta.
  const joined = new Set(found.flatMap((item) => [item.top, item.bottom]))
  const context = [...new Set(found.flatMap((item) => [item.upper.id, item.lower.id]))].flatMap((id) =>
    parsed
      .get(id)!
      .filter((item) => readable(item) && !joined.has(item))
      .map((item) => item.ocr_text!.trim()),
  )
  const result = await translate([...found.map((item) => item.text), ...context], language)
  database.transaction(() => {
    for (const { page, detection } of added) {
      const [x1, y1, x2, y2] = detection.box!.map((value) => Math.round(value))
      database
        .prepare(
          'INSERT INTO section_image_ocr_items (section_image_id, det_id, cls_name, conf, x1, y1, x2, y2, ocr_text, translated_text, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          page.image_id,
          detection.det_id,
          detection.cls_name || null,
          detection.conf ?? null,
          x1,
          y1,
          x2,
          y2,
          '',
          '',
          new Date().toISOString(),
        )
    }
    found.forEach((item, index) => {
      const value = result.translations[index]?.trim()
      item.top.ocr_text = item.text
      const update = database.prepare(
        'UPDATE section_image_ocr_items SET ocr_text=COALESCE(?, ocr_text), translated_text=COALESCE(?, translated_text) WHERE section_image_id=? AND det_id=?',
      )
      update.run(item.text, value || null, item.upper.image_id, item.top.det_id)
      update.run(null, value || null, item.lower.image_id, item.bottom.det_id)
    })
    for (const page of new Set(found.flatMap((item) => [item.upper, item.lower]))) {
      database.prepare('UPDATE work_pages SET ocr_json=?, render_stale=1 WHERE id=?').run(JSON.stringify(parsed.get(page.id)), page.id)
    }
  })()
  return found.length
}
