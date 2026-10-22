import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { renderTranslatedPage, type RenderDiagnostic, type RenderItem } from '../lib/server/render-translation'
import { extractTextBoxesNode } from '../lib/server/manga-ocr-node'
import { sameRow } from '../lib/server/text-detect'
import { eraseModels, workPageItems } from '../lib/backend/works/render'
import { configureInpaint } from '../lib/server/inpaint'
import { splitBalloons } from '../lib/backend/works/split-balloons'
import { isPromoText } from '../lib/promo-text'
import { ensureSources } from '../lib/backend/works/custom-sources'
import { qualityReports } from '../lib/backend/works/quality-reports'
import type { OcrDetection } from '../lib/backend/sections/sections.types'

// Conferência de qualidade (só leitura, sem IA): redesenha as páginas com o
// código atual a partir das traduções salvas e mede cada fala.
//   sobra          = letras do original que continuam visíveis depois de apagar
//   borrão         = área grande reconstruída a partir do redor (fundo com desenho)
//   miúda          = tradução desenhada em letra muito pequena
//   fora do balão  = parte do texto desenhado cai fora do balão
//   contorno       = o apagamento mudou traços fora das linhas (borda do balão, desenho)
//   sem tradução   = fala lida pelo OCR que ficou sem tradução
//   fala partida   = uma fala virou dois itens (palavras da mesma fileira)
//   corte          = fala cortada entre duas imagens que não foi juntada
//   inglês         = releitura da página pronta ainda acha palavras do original (KOMA_QUALITY_REREAD=1)
//
// KOMA_QUALITY=1 KOMA_QUALITY_WORKS=8,9,10,11 npx vitest run tests/quality.real.test.ts
// KOMA_QUALITY_SECTIONS=1326 confere capítulos específicos; KOMA_QUALITY_LAST=3 usa
// os últimos N capítulos prontos de cada obra (padrão 1).
//
// Trava de versão: KOMA_QUALITY=1 KOMA_QUALITY_SET=tests/quality-pages.json lê de
// novo (OCR atual, sem IA) as páginas que já tiveram cada tipo de erro e falha se
// algum voltar. A lista usa imagens da biblioteca local.
configureInpaint(process.env.KOMA_QUALITY_DEVICE === 'cpu' ? 'cpu' : 'webgpu')
const library = process.env.KOMA_QUALITY_LIBRARY || path.join(os.homedir(), '.local/share/koma/library')
const out = process.env.KOMA_QUALITY_OUT || path.join(os.tmpdir(), 'koma-qualidade')
export const LIMITS = { residue: 0.25, repainted: 0.5, size: 12, overflow: 0.08, border: 0.6 }

type Problem = 'sobra' | 'borrão' | 'miúda' | 'fora do balão' | 'contorno' | 'sem tradução' | 'fala partida' | 'corte' | 'inglês'
const PROBLEMS: Problem[] = ['sobra', 'borrão', 'miúda', 'fora do balão', 'contorno', 'sem tradução', 'fala partida', 'corte', 'inglês']
type Finding = { section?: number; page?: number; image: number; problem: Problem; source: string; value: number; crop?: string }
type Line = [number, number, number, number]
// Como no app: o nome das fontes do usuário carimbado nas páginas não é fala.
async function userSources(db: Database.Database) {
  process.env.KOMA_DATA_DIR ||= library
  await ensureSources(db, true)
}

function targets(db: Database.Database) {
  const sections = (process.env.KOMA_QUALITY_SECTIONS || '').split(',').filter(Boolean).map(Number)
  const last = Number(process.env.KOMA_QUALITY_LAST || 1)
  for (const work of (process.env.KOMA_QUALITY_WORKS || '').split(',').filter(Boolean).map(Number)) {
    const rows = db.prepare("SELECT section_id FROM work_chapters WHERE work_id=? AND state='ready' AND section_id IS NOT NULL ORDER BY position DESC LIMIT ?").all(work, last) as Array<{ section_id: number }>
    sections.push(...rows.map((row) => row.section_id))
  }
  return sections
}

async function save(bytes: Buffer, box: number[], name: string) {
  const meta = await sharp(bytes).metadata()
  const left = Math.max(0, Math.min(meta.width! - 1, box[0] - 40)); const top = Math.max(0, Math.min(meta.height! - 1, box[1] - 40))
  const file = path.join(out, name)
  await sharp(bytes).extract({ left, top, width: Math.max(1, Math.min(meta.width!, box[2] + 40) - left), height: Math.max(1, Math.min(meta.height!, box[3] + 40) - top) }).jpeg().toFile(file)
  return file
}

/** Duas falas da mesma página que são uma só: palavras de letra grande lado a lado na mesma fileira (a mesma regra da leitura). */
function splitSpeech(a: Line[], b: Line[], width: number) {
  const box = (line: Line) => ({ x1: line[0], y1: line[1], x2: line[2], y2: line[3], score: 1 })
  return a.some((p) => b.some((q) => sameRow(box(p), box(q), (x, y) => Math.min(x.y2 - x.y1, y.y2 - y.y1) < width * 0.07)))
}

const words = (text: string) => new Set((text.toUpperCase().match(/[A-Z]{4,}/g) || []))

/** Mede uma página desenhada; devolve os problemas achados. */
async function inspect(original: Buffer, items: RenderItem[], where: { section?: number; page?: number; image: number }, reread: boolean) {
  const findings: Finding[] = []
  const diagnostics: RenderDiagnostic[] = []
  // Como no app: com os modelos de apagamento (placa de vídeo, se houver).
  const rendered = await renderTranslatedPage(original, items, diagnostics, eraseModels(original))
  const tag = `s${where.section ?? 0}-p${where.page ?? 0}-${where.image}`
  for (const item of diagnostics) {
    const problems: Array<[Problem, number]> = []
    if (item.residue > LIMITS.residue) problems.push(['sobra', item.residue])
    if (item.repainted > LIMITS.repainted) problems.push(['borrão', item.repainted])
    if (item.size <= LIMITS.size) problems.push(['miúda', item.size])
    if (item.overflow > LIMITS.overflow) problems.push(['fora do balão', item.overflow])
    if (item.border > LIMITS.border) problems.push(['contorno', item.border])
    for (const [problem, value] of problems) findings.push({ ...where, problem, source: item.source, value: Math.round(value * 100) / 100, crop: await save(rendered, item.box, `${tag}-${problem}-${item.box[0]}-${item.box[1]}.jpg`) })
  }
  const width = (await sharp(original).metadata()).width!
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    if (splitSpeech(items[i].lines || [], items[j].lines || [], width)) findings.push({ ...where, problem: 'fala partida', source: `${items[i].source} + ${items[j].source}`, value: 1, crop: await save(original, [Math.min(items[i].box[0], items[j].box[0]), Math.min(items[i].box[1], items[j].box[1]), Math.max(items[i].box[2], items[j].box[2]), Math.max(items[i].box[3], items[j].box[3])], `${tag}-partida-${i}-${j}.jpg`) })
  }
  if (reread && items.length) {
    // Palavra do original que a tradução não tem (nome próprio fica) e que a
    // releitura da página pronta ainda acha: inglês que sobrou.
    const source = new Set(items.flatMap((item) => [...words(item.source || '')]))
    const kept = new Set(items.flatMap((item) => [...words(item.text)]))
    for (const detection of (await extractTextBoxesNode(rendered, 'en')).detections) {
      const left = [...words(detection.ocr_text)].filter((word) => source.has(word) && !kept.has(word))
      if (left.length) findings.push({ ...where, problem: 'inglês', source: left.join(' '), value: left.length, crop: await save(rendered, detection.box, `${tag}-ingles-${detection.box[0]}-${detection.box[1]}.jpg`) })
    }
  }
  return findings
}

it.skipIf(process.env.KOMA_QUALITY !== '1' || Boolean(process.env.KOMA_QUALITY_SET))('mede os erros de desenho e leitura dos capítulos traduzidos', async () => {
  const db = new Database(path.join(library, 'local.sqlite'), { readonly: true, fileMustExist: true })
  await userSources(db)
  fs.mkdirSync(out, { recursive: true })
  const reread = process.env.KOMA_QUALITY_REREAD === '1'
  const findings: Finding[] = []
  const summary: Array<{ section: number; falas: number } & Record<Problem, number>> = []
  for (const section of targets(db)) {
    const images = db.prepare('SELECT i.id, i.order_index, i.original_path, p.ocr_json, p.height FROM section_images i JOIN work_pages p ON p.image_id=i.id WHERE i.section_id=? ORDER BY i.order_index').all(section) as Array<{ id: number; order_index: number; original_path: string; ocr_json: string | null; height: number | null }>
    const before = findings.length
    let falas = 0
    for (const [index, image] of images.entries()) {
      if (!fs.existsSync(image.original_path)) continue
      const original = fs.readFileSync(image.original_path)
      const where = { section, page: image.order_index, image: image.id }
      const rows = db.prepare('SELECT det_id,x1,y1,x2,y2,ocr_text,translated_text FROM section_image_ocr_items WHERE section_image_id=?').all(image.id) as Array<{ det_id: number; x1: number; y1: number; x2: number; y2: number; ocr_text: string; translated_text: string }>
      for (const row of rows) {
        // Fala com cara de diálogo que ficou sem tradução (o modelo pode ter
        // pulado de propósito um crédito ou lixo do OCR; isso aparece aqui para conferir).
        if (!row.translated_text?.trim() && (row.ocr_text.match(/[A-Za-z]{3,}/g) || []).length >= 2 && !isPromoText(row.ocr_text)) {
          findings.push({ ...where, problem: 'sem tradução', source: row.ocr_text, value: 1, crop: await save(original, [row.x1, row.y1, row.x2, row.y2], `s${section}-p${image.order_index}-sem-${row.det_id}.jpg`) })
        }
      }
      // Fala cortada entre esta imagem e a seguinte que ficou em dois pedaços.
      const next = images[index + 1]
      if (next?.ocr_json && image.ocr_json) {
        const readable = (json: string) => (JSON.parse(json) as OcrDetection[]).filter((item) => !item.ocr_error && item.ocr_text?.trim())
        for (const [top, bottom] of splitBalloons(readable(image.ocr_json).filter((item) => !item.continued), image.height || (await sharp(original).metadata()).height!, readable(next.ocr_json).filter((item) => !item.continues))) {
          findings.push({ ...where, problem: 'corte', source: `${top.ocr_text} + ${bottom.ocr_text}`, value: 1, crop: await save(original, top.box!, `s${section}-p${image.order_index}-corte.jpg`) })
        }
      }
      const items = workPageItems(db, image.id)
      falas += items.length
      if (items.length) findings.push(...await inspect(original, items, where, reread))
    }
    const counts = Object.fromEntries(PROBLEMS.map((problem) => [problem, findings.slice(before).filter((item) => item.problem === problem).length])) as Record<Problem, number>
    summary.push({ section, falas, ...counts })
  }
  fs.writeFileSync(path.join(out, 'relatorio.json'), JSON.stringify({ checkedAt: new Date().toISOString(), limits: LIMITS, summary, findings }, null, 2))
  process.stderr.write(`[qualidade] ${JSON.stringify(summary)} em ${out}\n`)
  expect(summary.length).toBeGreaterThan(0)
}, 3 * 60 * 60 * 1000)

// Páginas que já tiveram cada tipo de erro. Cada uma é lida de novo pelo OCR atual
// e desenhada com a tradução salva (ou o próprio original, quando a fala mudou);
// "joins" são pares de imagens com uma fala cortada entre elas.
type RegressionSet = { pages: Array<{ image: number; why: string; expect?: string[]; absent?: string[]; allow?: Problem[] }>; joins?: Array<{ upper: number; lower: number; why: string }> }

it.skipIf(process.env.KOMA_QUALITY !== '1' || !process.env.KOMA_QUALITY_SET)('não deixa voltar erros já corrigidos', async () => {
  const db = new Database(path.join(library, 'local.sqlite'), { readonly: true, fileMustExist: true })
  await userSources(db)
  fs.mkdirSync(out, { recursive: true })
  const set = JSON.parse(fs.readFileSync(process.env.KOMA_QUALITY_SET!, 'utf8')) as RegressionSet
  const failures: string[] = []
  // Páginas reportadas no leitor ("Reportar erro"). Corrigidas: o mesmo tipo de erro
  // não pode voltar. Abertas: medidas e listadas como pendentes, sem travar.
  const REPORTED: Record<string, Problem[]> = { english: ['inglês', 'sem tradução'], outside: ['fora do balão', 'contorno'], 'too-big': [], name: [], other: [] }
  const reports = qualityReports(db)
  for (const report of reports.filter((item) => item.fixed)) set.pages.push({ image: report.image, why: `reportado: ${report.kind}${report.note ? ` (${report.note})` : ''}`, allow: PROBLEMS.filter((problem) => !REPORTED[report.kind]?.includes(problem)) })
  const pending: string[] = []
  const read = async (image: number) => {
    const row = db.prepare('SELECT original_path FROM section_images WHERE id=?').get(image) as { original_path: string } | undefined
    if (!row || !fs.existsSync(row.original_path)) return null
    const bytes = fs.readFileSync(row.original_path)
    return { bytes, height: (await sharp(bytes).metadata()).height!, detections: (await extractTextBoxesNode(bytes, 'en')).detections.filter((item) => !item.ocr_error && item.ocr_text?.trim()) }
  }
  for (const page of set.pages) {
    const found = await read(page.image)
    if (!found) { failures.push(`${page.image}: imagem fora da biblioteca`); continue }
    const flat = (text: string) => text.replace(/\s+/g, ' ').toUpperCase()
    // A fala esperada sai inteira num item só.
    for (const text of page.expect || []) if (!found.detections.some((item) => flat(item.ocr_text).includes(flat(text)))) failures.push(`${page.image} (${page.why}): leitura sem "${text}" — ${found.detections.map((item) => flat(item.ocr_text)).join(' | ')}`)
    // Propaganda e créditos não viram fala.
    for (const text of page.absent || []) if (found.detections.some((item) => flat(item.ocr_text).includes(flat(text)))) failures.push(`${page.image} (${page.why}): leitura ainda tem "${text}"`)
    const saved = db.prepare('SELECT ocr_text, translated_text FROM section_image_ocr_items WHERE section_image_id=?').all(page.image) as Array<{ ocr_text: string; translated_text: string }>
    // Como no app: só as falas com tradução são desenhadas (a salva, quando a leitura não mudou).
    const items: RenderItem[] = found.detections.filter((item) => !isPromoText(item.ocr_text)).flatMap((item) => {
      const same = saved.find((row) => row.translated_text?.trim() && flat(row.ocr_text) === flat(item.ocr_text!))
      return same ? [{ box: item.box, text: same.translated_text, source: item.ocr_text, kind: item.cls_name === 'text' ? 'text' as const : 'balloon' as const, lines: item.lines }] : []
    })
    // "allow": problema conhecido e ainda sem solução nesta página (fica registrado, não trava).
    for (const finding of (await inspect(found.bytes, items, { image: page.image }, false)).filter((item) => !page.allow?.includes(item.problem))) failures.push(`${page.image} (${page.why}): ${finding.problem} ${finding.value} "${finding.source}" ${finding.crop}`)
  }
  for (const join of set.joins || []) {
    const upper = await read(join.upper); const lower = await read(join.lower)
    if (!upper || !lower) { failures.push(`${join.upper}/${join.lower}: imagem fora da biblioteca`); continue }
    if (!splitBalloons(upper.detections, upper.height, lower.detections).length) failures.push(`${join.upper}/${join.lower} (${join.why}): fala cortada entre as imagens não reconhecida`)
  }
  for (const report of reports.filter((item) => !item.fixed)) {
    const found = await read(report.image)
    if (!found) continue
    const saved = db.prepare('SELECT ocr_text, translated_text FROM section_image_ocr_items WHERE section_image_id=?').all(report.image) as Array<{ ocr_text: string; translated_text: string }>
    const flat = (text: string) => text.replace(/\s+/g, ' ').toUpperCase()
    const items: RenderItem[] = found.detections.filter((item) => !isPromoText(item.ocr_text)).flatMap((item) => {
      const same = saved.find((row) => row.translated_text?.trim() && flat(row.ocr_text) === flat(item.ocr_text!))
      return same ? [{ box: item.box, text: same.translated_text, source: item.ocr_text, kind: item.cls_name === 'text' ? 'text' as const : 'balloon' as const, lines: item.lines }] : []
    })
    const findings = await inspect(found.bytes, items, { image: report.image }, false)
    pending.push(`${report.image} (${report.kind}${report.note ? `: ${report.note}` : ''}): ${findings.map((item) => item.problem).join(', ') || 'nenhum erro medido'}`)
  }
  if (pending.length) process.stderr.write(`[qualidade] reportados em aberto:\n${pending.join('\n')}\n`)
  fs.writeFileSync(path.join(out, 'regressao.json'), JSON.stringify({ checkedAt: new Date().toISOString(), failures, pending }, null, 2))
  expect(failures).toEqual([])
}, 60 * 60 * 1000)
