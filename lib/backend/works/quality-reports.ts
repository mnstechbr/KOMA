import type Database from 'better-sqlite3'

// Erros apontados pelo leitor ("Reportar erro"). Cada página reportada entra no
// gate de qualidade (tests/quality.real.test.ts): aberta, aparece como pendente;
// depois de corrigida ("fixed"), o mesmo tipo de erro não pode voltar nela.
export const REPORT_KINDS = ['english', 'outside', 'too-big', 'name', 'other'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]
export interface QualityReport {
  image: number
  page: number
  chapter: number
  work: number
  kind: ReportKind
  note: string
  balloon: number | null
  at: string
  fixed?: boolean
}
const KEY = 'koma:quality-reports:v1'

export function qualityReports(database: Database.Database): QualityReport[] {
  const row = database.prepare('SELECT value FROM kv_store WHERE key = ?').get(KEY) as { value: string } | undefined
  try {
    const list = row ? JSON.parse(row.value) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}
export function addQualityReport(
  database: Database.Database,
  chapterId: number,
  pageId: number,
  kind: ReportKind,
  note = '',
  balloon: number | null = null,
) {
  const page = database
    .prepare(
      'SELECT p.image_id, c.work_id FROM work_pages p JOIN work_chapters c ON c.id=p.chapter_id WHERE p.id=? AND p.chapter_id=? AND p.image_id IS NOT NULL',
    )
    .get(pageId, chapterId) as { image_id: number; work_id: number } | undefined
  if (!page) return null
  const report: QualityReport = {
    image: page.image_id,
    page: pageId,
    chapter: chapterId,
    work: page.work_id,
    kind,
    note: note.trim().slice(0, 500),
    balloon,
    at: new Date().toISOString(),
  }
  // O mesmo tipo de erro na mesma página conta uma vez (a nota mais recente fica).
  const list = [
    ...qualityReports(database).filter((item) => !(item.image === report.image && item.kind === kind && !item.fixed)),
    report,
  ].slice(-500)
  database
    .prepare(
      `INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = NULL`,
    )
    .run(KEY, JSON.stringify(list))
  return report
}
