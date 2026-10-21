import { NextResponse } from 'next/server'
import { personalAccess, sourceFailure } from '../works/_shared'
import { searchAllCatalogs } from '@/lib/backend/works/catalog'
import { ensureSources } from '@/lib/backend/works/custom-sources'
import { worksRepository } from '@/lib/backend/works/repository'

export async function GET(request: Request) {
  const auth = await personalAccess()
  if ('response' in auth) return auth.response
  try {
    const query = new URL(request.url).searchParams.get('q') || ''
    // MangaDex e as fontes personalizadas do usuário.
    await ensureSources(worksRepository.database)
    const { results, sources } = await searchAllCatalogs(query, request.signal)
    results.forEach((work) => worksRepository.cache(work))
    return NextResponse.json({ results, sources }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return sourceFailure(error) }
}
