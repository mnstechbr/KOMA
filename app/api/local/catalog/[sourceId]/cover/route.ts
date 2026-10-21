import { personalAccess, sourceFailure } from '../../../works/_shared'
import { getCover } from '@/lib/backend/works/service'
import { db } from '@/lib/backend/shared/database.module'
import { ensureSources } from '@/lib/backend/works/custom-sources'

export async function GET(_request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const auth = await personalAccess()
  if ('response' in auth) return auth.response
  try {
    await ensureSources(db)
    const bytes = await getCover((await params).sourceId)
    return bytes ? new Response(bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } }) : new Response(null, { status: 404 })
  } catch (error) { return sourceFailure(error) }
}
