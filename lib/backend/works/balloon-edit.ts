import type Database from 'better-sqlite3'
import type { OcrDetection } from '../sections/sections.types'
import { rememberCorrection } from './names'
import { renderWorkPage } from './render'

/**
 * Editor de balões do leitor: troca a tradução de um balão, desenha de novo só a
 * página dele (e a da outra metade, numa fala cortada entre imagens) e guarda a
 * correção no glossário da obra para os próximos capítulos.
 */
export async function editBalloon(database: Database.Database, chapterId: number, pageId: number, detId: number, text: string) {
  const page = database.prepare(`SELECT p.id, p.page_index, p.image_id, p.ocr_json, c.work_id FROM work_pages p JOIN work_chapters c ON c.id=p.chapter_id
    WHERE p.id=? AND p.chapter_id=? AND p.image_id IS NOT NULL`).get(pageId, chapterId) as { id: number; page_index: number; image_id: number; ocr_json: string | null; work_id: number } | undefined
  if (!page) return null
  const item = database.prepare('SELECT ocr_text, translated_text FROM section_image_ocr_items WHERE section_image_id=? AND det_id=?').get(page.image_id, detId) as { ocr_text: string; translated_text: string } | undefined
  if (!item) return null
  const value = text.replace(/\r/g, '').trim().slice(0, 600)
  const images = [page.image_id]
  // Fala cortada entre imagens: as duas metades usam a mesma tradução.
  const detections = JSON.parse(page.ocr_json || '[]') as OcrDetection[]
  const own = detections.find((detection) => detection.det_id === detId)
  let source = item.ocr_text
  let before = item.translated_text
  if (own?.box && (own.continued || own.continues)) {
    const other = database.prepare('SELECT image_id, ocr_json FROM work_pages WHERE chapter_id=? AND page_index=? AND image_id IS NOT NULL').get(chapterId, page.page_index + (own.continued ? 1 : -1)) as { image_id: number; ocr_json: string | null } | undefined
    const overlap = (a: number[], b: number[]) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) / Math.max(1, Math.min(a[2] - a[0], b[2] - b[0]))
    const partner = other && (JSON.parse(other.ocr_json || '[]') as OcrDetection[]).find((entry) => entry.box && (own.continued ? entry.continues : entry.continued) && overlap(entry.box, own.box!) >= 0.4)
    if (other && partner) {
      const half = database.prepare('SELECT ocr_text, translated_text FROM section_image_ocr_items WHERE section_image_id=? AND det_id=?').get(other.image_id, partner.det_id) as { ocr_text: string; translated_text: string } | undefined
      if (half && own.continues) { source = half.ocr_text || source; before = half.translated_text || before }
      database.prepare('UPDATE section_image_ocr_items SET translated_text=? WHERE section_image_id=? AND det_id=?').run(value, other.image_id, partner.det_id)
      images.push(other.image_id)
    }
  }
  database.prepare('UPDATE section_image_ocr_items SET translated_text=? WHERE section_image_id=? AND det_id=?').run(value, page.image_id, detId)
  // Fala corrigida pelo leitor: a releitura automática não a troca de novo.
  if (own) { own.seen = true; database.prepare('UPDATE work_pages SET ocr_json=? WHERE id=?').run(JSON.stringify(detections), page.id) }
  const term = value && value !== before ? rememberCorrection(database, page.work_id, source, before, value) : null
  for (const imageId of images) await renderWorkPage(database, imageId)
  return { images, term }
}
