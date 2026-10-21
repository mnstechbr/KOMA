import { NextResponse } from 'next/server'
import { personalAccess, sourceFailure } from './_shared'
import { worksRepository } from '@/lib/backend/works/repository'
import { getCatalogWork } from '@/lib/backend/works/service'
import { startWorkAutomation } from '@/lib/backend/works/worker'
import { ensureSources } from '@/lib/backend/works/custom-sources'

export async function GET() {
  const auth = await personalAccess()
  if ('response' in auth) return auth.response
  startWorkAutomation()
  return NextResponse.json({ works: worksRepository.list(auth.user.id) }, { headers: { 'Cache-Control': 'no-store' } })
}
export async function POST(request: Request) {
  const auth = await personalAccess(request)
  if ('response' in auth) return auth.response
  try {
    const body = await request.json()
    await ensureSources(worksRepository.database)
    const metadata = await getCatalogWork(body.sourceId)
    // Capítulos escolhidos na tela de adicionar; sem escolha, todos.
    const choice = Array.isArray(body.chapters) ? (body.chapters as Array<{ key?: unknown; number?: unknown }>).filter((item) => typeof item?.key === 'string').slice(0, 5000).map((item) => ({ key: String(item.key), number: typeof item.number === 'string' ? item.number : null })) : []
    const id = worksRepository.add(auth.user.id, metadata, choice)
    startWorkAutomation()
    return NextResponse.json({ id }, { status: 201 })
  } catch (error) { return sourceFailure(error) }
}
