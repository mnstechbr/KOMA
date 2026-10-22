import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import type { OcrDetection } from '../sections/sections.types'
import { type EraseModels, type RenderItem } from '@/lib/server/render-translation'
import { inpaintAvailable } from '@/lib/server/inpaint'
import { inpaintRegion, renderPage, textMaskOf } from '@/lib/server/ml'
import { SAME_LANGUAGE_SQL } from '@/lib/languages'
import { splitBalloons } from './split-balloons'
import { repeatedMarks } from './watermark'

// Página marcada para redesenhar que não tem fala traduzida (só efeito ou arte): não
// há o que desenhar, e ela não pode ficar contando como revisão pendente na fila.
export function clearEmptyRenders(database: Database.Database) {
  database
    .prepare(
      `UPDATE work_pages SET render_stale=0 WHERE render_stale=1 AND upgrade_pending=0
    AND NOT EXISTS(SELECT 1 FROM section_image_ocr_items o WHERE o.section_image_id=work_pages.image_id AND TRIM(o.translated_text)<>'')`,
    )
    .run()
}

// Páginas traduzidas cuja imagem final (texto apagado + PT-BR desenhado) ainda não existe.
export function nextPagesToRender(database: Database.Database, excluded: number[], limit: number) {
  return database
    .prepare(
      `SELECT i.id FROM work_pages p JOIN work_chapters c ON c.id=p.chapter_id JOIN works w ON w.id=c.work_id JOIN section_images i ON i.id=p.image_id
    WHERE p.state IN ('ready','review') AND p.upgrade_pending=0 AND p.ocr_json LIKE '%"lines"%' AND NOT ${SAME_LANGUAGE_SQL} AND (i.translated_path IS NULL OR p.render_stale=1)
    AND EXISTS(SELECT 1 FROM section_image_ocr_items o WHERE o.section_image_id=i.id AND TRIM(o.translated_text)<>'')
    ${excluded.length ? `AND i.id NOT IN (${excluded.map(() => '?').join(',')})` : ''}
    ORDER BY c.work_id, c.position, p.page_index LIMIT ?`,
    )
    .all(...excluded, limit) as Array<{ id: number }>
}

/** Páginas do capítulo com tradução que ainda não viraram imagem final. */
export function pendingRenderPages(database: Database.Database, chapterId: number, excluded: number[] = []) {
  return (
    database
      .prepare(
        `SELECT COUNT(*) AS n FROM work_pages p JOIN work_chapters c ON c.id=p.chapter_id JOIN works w ON w.id=c.work_id JOIN section_images i ON i.id=p.image_id
    WHERE p.chapter_id=? AND p.state IN ('ready','review') AND p.ocr_json LIKE '%"lines"%' AND NOT ${SAME_LANGUAGE_SQL} AND i.translated_path IS NULL
    AND EXISTS(SELECT 1 FROM section_image_ocr_items o WHERE o.section_image_id=i.id AND TRIM(o.translated_text)<>'')
    ${excluded.length ? `AND i.id NOT IN (${excluded.map(() => '?').join(',')})` : ''}`,
      )
      .get(chapterId, ...excluded) as { n: number }
  ).n
}

/** Capítulos que esperavam o desenho das páginas e já podem ficar prontos. */
export function chaptersDoneRendering(database: Database.Database, excluded: number[] = []) {
  return (database.prepare("SELECT id FROM work_chapters WHERE state='rendering'").all() as Array<{ id: number }>)
    .filter((chapter) => pendingRenderPages(database, chapter.id, excluded) === 0)
    .map((chapter) => chapter.id)
}

/** Modelos de apagamento para uma página; a máscara das letras só é calculada se alguma fala precisar. */
export function eraseModels(original: Buffer): EraseModels | undefined {
  if (!inpaintAvailable()) return undefined
  let mask: Promise<Uint8Array | null> | null = null
  return {
    mask: () => (mask ||= textMaskOf(original).catch(() => null)),
    inpaint: (data, width, height, holes) => inpaintRegion(data, width, height, holes).catch(() => false),
  }
}

/** Falas de uma página como o desenho as recebe (inclusive balões cortados entre imagens). */
export function workPageItems(database: Database.Database, imageId: number) {
  const page = database.prepare('SELECT ocr_json, chapter_id, page_index, height FROM work_pages WHERE image_id=?').get(imageId) as
    { ocr_json: string | null; chapter_id: number; page_index: number; height: number | null } | undefined
  const detections = new Map((JSON.parse(page?.ocr_json || '[]') as OcrDetection[]).map((detection) => [detection.det_id, detection]))
  // Balão cortado entre esta imagem e a vizinha: as duas desenham a fala inteira
  // sobre o balão completo; cada uma mostra a parte que lhe cabe.
  const neighbor = (offset: number) => {
    if (!page) return null
    const row = database
      .prepare('SELECT ocr_json, height, image_id FROM work_pages WHERE chapter_id=? AND page_index=?')
      .get(page.chapter_id, page.page_index + offset) as
      { ocr_json: string | null; height: number | null; image_id: number | null } | undefined
    return row?.ocr_json ? { detections: JSON.parse(row.ocr_json) as OcrDetection[], height: row.height || 0, imageId: row.image_id } : null
  }
  const shift = (lines: Array<[number, number, number, number]> | undefined, dy: number) =>
    (lines || []).map(([x1, y1, x2, y2]): [number, number, number, number] => [x1, y1 + dy, x2, y2 + dy])
  const across = (detection: OcrDetection | undefined) => {
    if (!detection?.box || !page) return null
    if (detection.continued) {
      const next = neighbor(1)
      const bottom = next
        ? splitBalloons(
            [detection],
            page.height || 0,
            next.detections.filter((item) => item.continues),
          )[0]?.[1]
        : undefined
      if (!bottom) return null
      const height = page.height || 0
      return {
        lines: [...(detection.lines || []), ...shift(bottom.lines, height)],
        box: [
          Math.min(detection.box[0], bottom.box![0]),
          detection.box[1],
          Math.max(detection.box[2], bottom.box![2]),
          bottom.box![3] + height,
        ] as [number, number, number, number],
        text: null,
        source: detection.ocr_text || '',
        kind: detection.cls_name,
      }
    }
    if (detection.continues) {
      const previous = neighbor(-1)
      const top = previous
        ? splitBalloons(
            previous.detections.filter((item) => item.continued),
            previous.height,
            [detection],
          )[0]?.[0]
        : undefined
      if (!top || !previous) return null
      const text = (
        database
          .prepare('SELECT translated_text FROM section_image_ocr_items WHERE section_image_id=? AND det_id=?')
          .get(previous.imageId, top.det_id) as { translated_text: string } | undefined
      )?.translated_text
      return {
        lines: [...shift(top.lines, -previous.height), ...(detection.lines || [])],
        box: [
          Math.min(top.box![0], detection.box[0]),
          top.box![1] - previous.height,
          Math.max(top.box![2], detection.box[2]),
          detection.box[3],
        ] as [number, number, number, number],
        text: text?.trim() || null,
        source: top.ocr_text || '',
        kind: top.cls_name,
      }
    }
    return null
  }
  const rows = database
    .prepare('SELECT det_id,x1,y1,x2,y2,ocr_text,translated_text FROM section_image_ocr_items WHERE section_image_id=? ORDER BY id')
    .all(imageId) as Array<{ det_id: number; x1: number; y1: number; x2: number; y2: number; ocr_text: string; translated_text: string }>
  // O logotipo com o nome da obra (capa e créditos) não é fala: fica como está.
  const work = database
    .prepare(
      'SELECT w.title, w.metadata_json FROM works w JOIN work_chapters c ON c.work_id=w.id JOIN work_pages p ON p.chapter_id=c.id WHERE p.image_id=?',
    )
    .get(imageId) as { title: string; metadata_json: string } | undefined
  const titles = work
    ? [work.title, ...((JSON.parse(work.metadata_json || '{}').aliases || []) as Array<{ title: string }>).map((alias) => alias.title)]
    : []
  const isTitle = (text: string) => titles.some((title) => similarity(title, text) >= 0.7)
  const items: RenderItem[] = rows
    .filter((row) => row.translated_text?.trim() && !isTitle(row.ocr_text))
    .map((row) => {
      const detection = detections.get(row.det_id)
      const joined = across(detection)
      return {
        box: joined?.box || [row.x1, row.y1, row.x2, row.y2],
        text: joined?.text || row.translated_text.trim(),
        source: joined?.source || row.ocr_text,
        kind: (joined?.kind ?? detection?.cls_name) === 'text' ? 'text' : 'balloon',
        lines: joined?.lines || detection?.lines,
        joined: Boolean(joined),
      }
    })
  return items
}

export async function renderWorkPage(database: Database.Database, imageId: number) {
  const image = database.prepare('SELECT original_path, order_index FROM section_images WHERE id=?').get(imageId) as
    { original_path: string; order_index: number } | undefined
  if (!image) return
  const original = fs.readFileSync(image.original_path)
  // O que foi desenhado: se a tradução ou a leitura mudar durante o desenho (releitura
  // pela IA, junção de fala cortada), a página continua marcada para desenhar de novo.
  const snapshot = () =>
    JSON.stringify([
      workPageItems(database, imageId),
      (database.prepare('SELECT ocr_json FROM work_pages WHERE image_id=?').get(imageId) as { ocr_json: string | null } | undefined)
        ?.ocr_json,
    ])
  const drawn = snapshot()
  const output = await renderPage(original, workPageItems(database, imageId), eraseModels(original))
  const directory = path.join(path.dirname(path.dirname(image.original_path)), 'translated')
  fs.mkdirSync(directory, { recursive: true })
  // Nome com versão: o leitor guarda imagens em cache pelo endereço.
  const target = path.join(directory, `${String(image.order_index + 1).padStart(4, '0')}-${Date.now().toString(36)}.jpg`)
  fs.writeFileSync(`${target}.partial`, output)
  fs.renameSync(`${target}.partial`, target)
  database.prepare('UPDATE section_images SET translated_path=? WHERE id=?').run(target, imageId)
  database.prepare('UPDATE work_pages SET render_stale=? WHERE image_id=?').run(snapshot() === drawn ? 0 : 1, imageId)
  // Versões anteriores da mesma página (inclusive de traduções refeitas).
  const prefix = `${String(image.order_index + 1).padStart(4, '0')}-`
  for (const name of fs.readdirSync(directory))
    if (name.startsWith(prefix) && path.join(directory, name) !== target) fs.rmSync(path.join(directory, name), { force: true })
}

// Páginas traduzidas antes da 0.4.8: refazer o OCR (agora com narração fora de
// balões e linhas completas) reaproveitando as traduções já pagas; só os
// trechos novos vão ao modelo. O capítulo continua disponível para leitura.
export function nextPagesToUpgrade(database: Database.Database, excluded: number[], limit: number) {
  return database
    .prepare(
      `SELECT p.id,p.image_id,p.chapter_id,c.language,c.work_id,w.target_language FROM work_pages p JOIN work_chapters c ON c.id=p.chapter_id JOIN works w ON w.id=c.work_id
    WHERE p.upgrade_pending=1 AND p.image_id IS NOT NULL AND w.paused=0
    AND NOT EXISTS(SELECT 1 FROM work_chapter_cloud k WHERE k.chapter_id=c.id AND k.evicted=1) ${excluded.length ? `AND p.id NOT IN (${excluded.map(() => '?').join(',')})` : ''}
    ORDER BY c.work_id, c.position, p.page_index LIMIT ?`,
    )
    .all(...excluded, limit) as Array<{
    id: number
    image_id: number
    chapter_id: number
    language: string
    work_id: number
    target_language: string
  }>
}
export function similarity(a: string, b: string) {
  const x = (a || '').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '')
  const y = (b || '').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '')
  if (!x || !y) return 0
  let previous = Array.from({ length: y.length + 1 }, (_, i) => i)
  for (let i = 1; i <= x.length; i++) {
    const current = [i]
    for (let j = 1; j <= y.length; j++)
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1))
    previous = current
  }
  return 1 - previous[y.length] / Math.max(x.length, y.length)
}
const overlap = (a: number[], b: number[]) => {
  const inter = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  return inter / Math.max(1, Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])))
}
export async function upgradeWorkPage(
  database: Database.Database,
  page: { id: number; image_id: number; language: string },
  recognize: (bytes: Buffer, language: string) => Promise<OcrDetection[]>,
  translate: (texts: string[], source: string) => Promise<{ translations: string[]; flagged?: number[] }>,
  replace: (imageId: number, detections: OcrDetection[], translations: Map<number, string>) => void,
) {
  const image = database.prepare('SELECT original_path FROM section_images WHERE id=?').get(page.image_id) as { original_path: string }
  const old = database
    .prepare('SELECT x1,y1,x2,y2,ocr_text,translated_text FROM section_image_ocr_items WHERE section_image_id=?')
    .all(page.image_id) as Array<{ x1: number; y1: number; x2: number; y2: number; ocr_text: string; translated_text: string }>
  const detections = (await recognize(fs.readFileSync(image.original_path), page.language)).filter(
    (detection) => !detection.ocr_error && detection.ocr_text?.trim(),
  )
  const translations = new Map<number, string>()
  const missing: number[] = []
  // Marca d'água repetida nas páginas do capítulo (lida em pedaços) fica sem tradução.
  const row = database.prepare('SELECT * FROM work_pages WHERE id=?').get(page.id) as
    { chapter_id?: number; height?: number | null } | undefined
  const neighbors = row?.chapter_id
    ? (database
        .prepare('SELECT * FROM work_pages WHERE chapter_id=? AND ocr_json IS NOT NULL AND id<>?')
        .all(row.chapter_id, page.id) as Array<{ height?: number | null; ocr_json: string }>)
    : []
  const marks = repeatedMarks([
    { height: row?.height || 0, detections },
    ...neighbors.map((other) => ({ height: other.height || 0, detections: JSON.parse(other.ocr_json) as OcrDetection[] })),
  ])
  detections.forEach((detection, index) => {
    if (marks.has(detection)) return
    // Só reaproveitar quando o texto lido agora é praticamente o mesmo de antes:
    // traduções feitas sobre OCR errado são refeitas.
    const previous = old.find(
      (row) =>
        row.translated_text?.trim() &&
        overlap([row.x1, row.y1, row.x2, row.y2], detection.box!) > 0.5 &&
        similarity(row.ocr_text, detection.ocr_text!) >= 0.85,
    )
    if (previous) translations.set(index, previous.translated_text)
    else missing.push(index)
  })
  if (missing.length) {
    const result = await translate(
      missing.map((index) => detections[index].ocr_text!.trim()),
      page.language,
    )
    if (result.translations.length !== missing.length) throw new Error('incomplete')
    const flagged = new Set((result as { flagged?: number[] }).flagged || [])
    const unchanged = (a: string, b: string) =>
      a.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '') === b.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '')
    missing.forEach((index, i) => {
      const value = result.translations[i]?.trim()
      // Fala ilegível devolvida sem tradução fica no original.
      if (value && !(flagged.has(i) && unchanged(value, detections[index].ocr_text!))) translations.set(index, value)
      if (flagged.has(i)) detections[index].doubtful = true
    })
  }
  database.transaction(() => {
    replace(page.image_id, detections, translations)
    database.prepare('UPDATE work_pages SET ocr_json=?,upgrade_pending=0 WHERE id=?').run(JSON.stringify(detections), page.id)
    // A página traduzida anterior continua visível até a nova ficar pronta. Sem
    // nenhuma fala traduzida não há o que desenhar: vale a página original.
    if (translations.size) database.prepare('UPDATE work_pages SET render_stale=1 WHERE id=?').run(page.id)
    else {
      database.prepare('UPDATE work_pages SET render_stale=0 WHERE id=?').run(page.id)
      database.prepare('UPDATE section_images SET translated_path=NULL WHERE id=?').run(page.image_id)
    }
    // Página antes pendente que agora tem tradução: conta como pronta; o capítulo também, se não restar pendência.
    // Página com tradução, ou sem nenhum texto legível, deixa de ficar pendente.
    if (translations.size || !detections.length) {
      database
        .prepare("UPDATE work_pages SET state='ready',message=? WHERE id=? AND state='review'")
        .run(detections.length ? '' : 'Nenhum diálogo encontrado após nova leitura; original preservado.', page.id)
      database
        .prepare(
          `UPDATE work_chapters SET state='ready',message='' WHERE state='partial' AND id=(SELECT chapter_id FROM work_pages WHERE id=?)
        AND NOT EXISTS(SELECT 1 FROM work_pages WHERE chapter_id=work_chapters.id AND state<>'ready')`,
        )
        .run(page.id)
    }
  })()
  return missing.length
}
