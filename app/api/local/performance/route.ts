import { NextResponse } from 'next/server'
import { requireAdmin } from '@/app/api/_shared/proxy'
import { isTrustedOrigin } from '@/lib/security/request-guards'
import { db } from '@/lib/backend/shared/database.module'
import { currentPerformance, detectGpu, savePerformanceMode, saveUsageLimit } from '@/lib/backend/works/performance'
import { probeGpuDevice as probeGpu } from '@/lib/server/ml'

export async function GET() {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  await detectGpu(probeGpu)
  return NextResponse.json(currentPerformance(db), { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request) {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  if (process.env.KOMA_DESKTOP !== '1' || !isTrustedOrigin(request))
    return NextResponse.json({ message: 'Ação não autorizada.' }, { status: 403 })
  const { mode, usage, guard } = (await request.json().catch(() => ({}))) as { mode?: unknown; usage?: unknown; guard?: unknown }
  try {
    if (mode !== undefined) savePerformanceMode(db, mode)
    if (usage !== undefined || guard !== undefined) saveUsageLimit(db, { usage, guard })
  } catch (error) {
    return NextResponse.json({ message: (error as Error).message }, { status: 400 })
  }
  await detectGpu(probeGpu)
  return NextResponse.json(currentPerformance(db))
}
