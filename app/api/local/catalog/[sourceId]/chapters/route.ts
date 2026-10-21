import { NextResponse } from 'next/server'
import { personalAccess, sourceFailure } from '../../../works/_shared'
import { catalogChapters } from '@/lib/backend/works/catalog'
import { db } from '@/lib/backend/shared/database.module'
import { ensureSources } from '@/lib/backend/works/custom-sources'

export async function GET(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const auth = await personalAccess()
  if ('response' in auth) return auth.response
  try {
    await ensureSources(db)
    const chapters = await catalogChapters((await params).sourceId, request.signal)
    return NextResponse.json({ chapters, total: chapters.length }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return sourceFailure(error) }
}
