import { NextResponse } from 'next/server'
import { personalAccess, numericId } from '../../../../_shared'
import { worksRepository } from '@/lib/backend/works/repository'
import { editBalloon } from '@/lib/backend/works/balloon-edit'

type Context = { params: Promise<{ id: string; chapterId: string }> }
// Editor de balões: nova tradução de um balão; devolve as páginas desenhadas de novo.
export async function PATCH(request: Request, { params }: Context) {
  const auth = await personalAccess(request)
  if ('response' in auth) return auth.response
  const { id, chapterId } = await params
  const detail = worksRepository.detail(numericId(id), auth.user.id)
  const chapter = detail?.chapters.find((item) => item.id === numericId(chapterId))
  if (!detail || !chapter) return NextResponse.json({ message: 'Capítulo não encontrado.' }, { status: 404 })
  const body = (await request.json().catch(() => ({}))) as { pageId?: unknown; balloonId?: unknown; text?: unknown }
  if (!Number.isInteger(body.pageId) || !Number.isInteger(body.balloonId) || typeof body.text !== 'string' || body.text.length > 600)
    return NextResponse.json({ message: 'Informe o balão e o novo texto (até 600 caracteres).' }, { status: 400 })
  try {
    const result = await editBalloon(worksRepository.database, chapter.id, body.pageId as number, body.balloonId as number, body.text)
    if (!result) return NextResponse.json({ message: 'Balão não encontrado.' }, { status: 404 })
    const pages = result.images.map((imageId) => {
      const page = worksRepository.database
        .prepare('SELECT p.id, i.translated_path FROM work_pages p JOIN section_images i ON i.id=p.image_id WHERE p.image_id=?')
        .get(imageId) as { id: number; translated_path: string | null }
      return {
        id: page.id,
        translatedUrl: page.translated_path
          ? `/api/sections/${chapter.sectionId}/images/${imageId}/translated/view?v=${encodeURIComponent(page.translated_path.split('/').pop() || '')}`
          : null,
      }
    })
    return NextResponse.json({ pages, term: result.term })
  } catch {
    return NextResponse.json({ message: 'Não foi possível desenhar a página de novo.' }, { status: 500 })
  }
}
