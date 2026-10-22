import { NextResponse } from 'next/server'
import { personalAccess, numericId } from '../_shared'
import { worksRepository } from '@/lib/backend/works/repository'
import { pauseRunningWork, startWorkAutomation } from '@/lib/backend/works/worker'
import { SourceError } from '@/lib/backend/works/source-http'
import { ensureSources } from '@/lib/backend/works/custom-sources'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await personalAccess()
  if ('response' in auth) return auth.response
  const detail = worksRepository.detail(numericId((await params).id), auth.user.id)
  return detail
    ? NextResponse.json(detail, { headers: { 'Cache-Control': 'no-store' } })
    : NextResponse.json({ message: 'Obra não encontrada.' }, { status: 404 })
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await personalAccess(request)
  if ('response' in auth) return auth.response
  const body = await request.json().catch(() => ({}))
  if (body.action === 'source') {
    try {
      if (typeof body.url !== 'string' || body.url.length > 500) throw new SourceError('Informe o link da obra.')
      await ensureSources(worksRepository.database)
      if (!worksRepository.bindSource(numericId((await params).id), auth.user.id, body.url))
        return NextResponse.json({ message: 'Obra não encontrada.' }, { status: 404 })
      startWorkAutomation()
      return NextResponse.json({ ok: true })
    } catch (error) {
      return NextResponse.json({ message: error instanceof SourceError ? error.message : 'Link de fonte inválido.' }, { status: 400 })
    }
  }
  if (
    !['refresh', 'pause', 'resume', 'favorite'].includes(body.action) ||
    (body.action === 'favorite' && typeof body.favorite !== 'boolean')
  )
    return NextResponse.json({ message: 'Ação inválida.' }, { status: 400 })
  const id = numericId((await params).id)
  const found = worksRepository.control(id, auth.user.id, body.action, body.favorite)
  if (!found) return NextResponse.json({ message: 'Obra não encontrada.' }, { status: 404 })
  if (body.action === 'pause') pauseRunningWork(id)
  startWorkAutomation()
  return NextResponse.json({ ok: true })
}
