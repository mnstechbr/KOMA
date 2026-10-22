import { NextResponse } from 'next/server'
import { personalAccess, numericId } from '../../../../_shared'
import { worksRepository } from '@/lib/backend/works/repository'
import { addQualityReport, REPORT_KINDS, type ReportKind } from '@/lib/backend/works/quality-reports'

type Context = { params: Promise<{ id: string; chapterId: string }> }
// "Reportar erro" no leitor: a página entra no gate de qualidade.
export async function POST(request: Request, { params }: Context) {
  const auth = await personalAccess(request)
  if ('response' in auth) return auth.response
  const { id, chapterId } = await params
  const detail = worksRepository.detail(numericId(id), auth.user.id)
  const chapter = detail?.chapters.find((item) => item.id === numericId(chapterId))
  if (!detail || !chapter) return NextResponse.json({ message: 'Capítulo não encontrado.' }, { status: 404 })
  const body = await request.json().catch(() => ({})) as { pageId?: unknown; kind?: unknown; note?: unknown; balloonId?: unknown }
  if (!Number.isInteger(body.pageId) || !REPORT_KINDS.includes(body.kind as ReportKind) || (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 500))) return NextResponse.json({ message: 'Informe a página e o tipo de erro.' }, { status: 400 })
  const report = addQualityReport(worksRepository.database, chapter.id, body.pageId as number, body.kind as ReportKind, (body.note as string | undefined) || '', Number.isInteger(body.balloonId) ? body.balloonId as number : null)
  return report ? NextResponse.json({ ok: true }) : NextResponse.json({ message: 'Página não encontrada.' }, { status: 404 })
}
