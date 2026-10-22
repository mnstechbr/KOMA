import { NextResponse } from 'next/server'
import { personalAccess, numericId } from '../../../_shared'
import { worksRepository } from '@/lib/backend/works/repository'
import { ensureChapterLocal } from '@/lib/backend/storage/cloud'
import { startWorkAutomation } from '@/lib/backend/works/worker'
import { syncAniListWork } from '@/lib/backend/works/anilist'

type Context = { params: Promise<{ id: string; chapterId: string }> }
export async function GET(_request: Request, { params }: Context) {
  const auth = await personalAccess()
  if ('response' in auth) return auth.response
  const { id, chapterId } = await params
  const detail = worksRepository.detail(numericId(id), auth.user.id)
  const chapter = detail?.chapters.find((chapter) => chapter.id === numericId(chapterId))
  if (!detail || !chapter) return NextResponse.json({ message: 'Capítulo não encontrado.' }, { status: 404 })
  if (!['ready', 'partial'].includes(chapter.state))
    return NextResponse.json({ message: 'Este capítulo ainda está sendo preparado. Acompanhe o andamento na obra.' }, { status: 409 })
  // Modo "só na nuvem": baixa as páginas antes de abrir.
  try {
    await ensureChapterLocal(worksRepository.database, chapter.id)
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? `Não foi possível baixar o capítulo da nuvem. ${error.message}`
            : 'Não foi possível baixar o capítulo da nuvem.',
      },
      { status: 503 },
    )
  }
  const pages = worksRepository.pages(chapter.id).map((page) => {
    const colors = JSON.parse(page.ocr_json || '[]') as Array<{ det_id?: number; background?: string; foreground?: string }>
    const items = worksRepository.database
      .prepare('SELECT det_id, x1,y1,x2,y2,translated_text FROM section_image_ocr_items WHERE section_image_id=? ORDER BY id')
      .all(page.image_id) as Array<{ det_id: number; x1: number; y1: number; x2: number; y2: number; translated_text: string }>
    const rendered = (
      worksRepository.database.prepare('SELECT translated_path FROM section_images WHERE id=?').get(page.image_id) as
        { translated_path: string | null } | undefined
    )?.translated_path
    return {
      id: page.id,
      note: page.message?.startsWith('Página já disponível') ? null : page.message || null,
      width: page.width,
      height: page.height,
      originalUrl: `/api/sections/${chapter.sectionId}/images/${page.image_id}/original/view`,
      translatedUrl: rendered
        ? `/api/sections/${chapter.sectionId}/images/${page.image_id}/translated/view?v=${encodeURIComponent(rendered.split('/').pop() || '')}`
        : null,
      items: items.map((item) => {
        const color = colors.find((color) => color.det_id === item.det_id)
        return {
          id: item.det_id,
          box: [item.x1, item.y1, item.x2, item.y2],
          text: item.translated_text,
          background: color?.background,
          foreground: color?.foreground,
        }
      }),
    }
  })
  const index = detail.chapters.findIndex((item) => item.id === chapter.id)
  const next = detail.chapters[index + 1]
  const previous = detail.chapters[index - 1]
  worksRepository.touch(detail.work.id, auth.user.id)
  // Já deixa o próximo capítulo no computador enquanto este é lido.
  if (next && next.state === 'ready') void ensureChapterLocal(worksRepository.database, next.id).catch(() => undefined)
  return NextResponse.json(
    {
      work: detail.work,
      chapter,
      pages,
      nextChapterId: next && ['ready', 'partial'].includes(next.state) ? next.id : null,
      previousChapterId: previous && ['ready', 'partial'].includes(previous.state) ? previous.id : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
export async function POST(request: Request, { params }: Context) {
  const auth = await personalAccess(request)
  if ('response' in auth) return auth.response
  const { id, chapterId } = await params
  const detail = worksRepository.detail(numericId(id), auth.user.id)
  if (!detail?.chapters.some((chapter) => chapter.id === numericId(chapterId) && ['ready', 'partial'].includes(chapter.state)))
    return NextResponse.json({ message: 'Capítulo não disponível.' }, { status: 404 })
  worksRepository.markRead(numericId(id), numericId(chapterId), auth.user.id)
  // AniList (se conectado): o maior capítulo lido, sem segurar a resposta.
  void syncAniListWork(worksRepository.database, numericId(id)).catch(() => undefined)
  return NextResponse.json({ ok: true })
}
// "Refazer este capítulo" (leitura e tradução do zero) ou baixar um capítulo não escolhido ao adicionar a obra.
export async function PATCH(request: Request, { params }: Context) {
  const auth = await personalAccess(request)
  if ('response' in auth) return auth.response
  const { id, chapterId } = await params
  const { action } = (await request.json().catch(() => ({}))) as { action?: string }
  if (action !== 'redo' && action !== 'download') return NextResponse.json({ message: 'Ação inválida.' }, { status: 400 })
  if (!worksRepository.chapterAction(numericId(id), numericId(chapterId), auth.user.id, action))
    return NextResponse.json({ message: 'Capítulo não encontrado.' }, { status: 404 })
  startWorkAutomation()
  return NextResponse.json({ ok: true })
}
