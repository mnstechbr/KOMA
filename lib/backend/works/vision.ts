import fs from 'node:fs'
import type Database from 'better-sqlite3'
import sharp from 'sharp'
import type { OcrDetection } from '../sections/sections.types'

export type ReadImages = (
  items: Array<{ png: Buffer; ocr: string }>,
  source: string,
) => Promise<Array<{ source: string; text: string; skip: boolean }> | null>

/**
 * Releitura pela IA das falas que o modelo marcou como leitura duvidosa (letra
 * borrada, estilizada ou cortada: "LOUR LAA", "PfOENIX RRE 900"): o recorte da
 * imagem vai ao modelo, que lê e traduz de novo. Cada fala é lida uma vez só.
 */
export async function visionReview(database: Database.Database, chapterId: number, language: string, read: ReadImages) {
  const pages = database
    .prepare(
      'SELECT p.id, p.ocr_json, i.id AS image_id, i.original_path FROM work_pages p JOIN section_images i ON i.id=p.image_id WHERE p.chapter_id=? AND p.ocr_json IS NOT NULL ORDER BY p.page_index',
    )
    .all(chapterId) as Array<{ id: number; ocr_json: string; image_id: number; original_path: string }>
  const pending: Array<{
    page: (typeof pages)[number]
    detections: OcrDetection[]
    detection: OcrDetection
    png: Buffer
    partner?: { page: (typeof pages)[number]; detection: OcrDetection; detections: OcrDetection[] }
  }> = []
  const parsed = new Map(pages.map((page) => [page.id, JSON.parse(page.ocr_json) as OcrDetection[]]))
  const overlap = (a: number[], b: number[]) =>
    Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) / Math.max(1, Math.min(a[2] - a[0], b[2] - b[0]))
  // Fala cortada entre imagens: a outra metade, que recebe a mesma tradução.
  const partnerOf = (index: number, item: OcrDetection) => {
    const other = item.continues ? pages[index - 1] : item.continued ? pages[index + 1] : undefined
    if (!other || !item.box) return undefined
    const list = parsed.get(other.id)!
    const detection = list.find(
      (entry) => entry.box && (item.continues ? entry.continued : entry.continues) && overlap(entry.box, item.box!) >= 0.4,
    )
    return detection ? { page: other, detection, detections: list } : undefined
  }
  for (const [index, page] of pages.entries()) {
    const detections = parsed.get(page.id)!
    // Da fala cortada, só a metade maior vai para a IA (a outra recebe a mesma resposta).
    const doubtful = detections.filter((item) => {
      if (!item.box || !item.ocr_text?.trim()) return false
      if (!(item.continued || item.continues)) return Boolean(item.doubtful && !item.seen)
      const partner = partnerOf(index, item)
      if (!partner || item.seen || partner.detection.seen || !(item.doubtful || partner.detection.doubtful)) return false
      return item.box[3] - item.box[1] >= partner.detection.box![3] - partner.detection.box![1]
    })
    if (!doubtful.length || !fs.existsSync(page.original_path)) continue
    const crop = async (file: string, box: number[]) => {
      const meta = await sharp(file).metadata()
      const [x1, y1, x2, y2] = box
      const margin = Math.max(16, Math.round(Math.max(x2 - x1, y2 - y1) * 0.1))
      const left = Math.max(0, x1 - margin)
      const width = Math.min(meta.width!, x2 + margin) - left
      // Metade de fala cortada: sem folga do lado do corte (a outra metade vem colada).
      const top = Math.max(0, y1 - margin)
      const bottom = Math.min(meta.height!, y2 + margin)
      return { left, width, top, height: bottom - top, file }
    }
    for (const detection of doubtful) {
      const partner = partnerOf(index, detection)
      const own = await crop(page.original_path, detection.box!)
      if (own.width < 8 || own.height < 8) continue
      let png: Buffer
      if (partner && fs.existsSync(partner.page.original_path)) {
        // Fala cortada entre imagens: as duas metades coladas, para a IA ler a frase inteira.
        const other = await crop(partner.page.original_path, partner.detection.box!)
        const [upper, lower] = detection.continued ? [own, other] : [other, own]
        const left = Math.min(upper.left, lower.left)
        const width = Math.max(upper.left + upper.width, lower.left + lower.width) - left
        const parts = await Promise.all(
          [upper, lower].map((part) =>
            sharp(part.file).extract({ left: part.left, top: part.top, width: part.width, height: part.height }).png().toBuffer(),
          ),
        )
        png = await sharp({ create: { width, height: upper.height + lower.height, channels: 3, background: '#ffffff' } })
          .composite([
            { input: parts[0], top: 0, left: upper.left - left },
            { input: parts[1], top: upper.height, left: lower.left - left },
          ])
          .png()
          .toBuffer()
        png = await sharp(png).resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
      } else
        png = await sharp(page.original_path)
          .extract({ left: own.left, top: own.top, width: own.width, height: own.height })
          .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer()
      pending.push({ page, detections, detection, png, partner })
    }
  }
  let changed = 0
  for (let start = 0; start < pending.length; start += 20) {
    const group = pending.slice(start, start + 20)
    const result = await read(
      group.map((item) => ({ png: item.png, ocr: item.detection.ocr_text || '' })),
      language,
    )
    if (!result) return changed
    database.transaction(() => {
      group.forEach((item, index) => {
        const answer = result[index]
        item.detection.seen = true
        // Fala cortada: o texto inteiro fica na metade de cima, como na junção.
        const holder = item.partner && item.detection.continues ? item.partner : null
        if (!answer?.source) return
        if (holder) holder.detection.ocr_text = answer.source
        else item.detection.ocr_text = answer.source
        database
          .prepare('UPDATE section_image_ocr_items SET ocr_text=?, translated_text=? WHERE section_image_id=? AND det_id=?')
          .run(holder ? item.detection.ocr_text || '' : answer.source, answer.text, item.page.image_id, item.detection.det_id)
        if (item.partner) {
          item.partner.detection.seen = true
          database
            .prepare('UPDATE section_image_ocr_items SET translated_text=?, ocr_text=? WHERE section_image_id=? AND det_id=?')
            .run(answer.text, item.partner.detection.ocr_text || '', item.partner.page.image_id, item.partner.detection.det_id)
          database
            .prepare('UPDATE work_pages SET ocr_json=?, render_stale=1 WHERE id=?')
            .run(JSON.stringify(item.partner.detections), item.partner.page.id)
        }
        changed++
      })
      for (const page of new Set(group.map((item) => item.page))) {
        const detections = group.find((item) => item.page === page)!.detections
        database.prepare('UPDATE work_pages SET ocr_json=?, render_stale=1 WHERE id=?').run(JSON.stringify(detections), page.id)
      }
    })()
  }
  return changed
}
