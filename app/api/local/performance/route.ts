import { NextResponse } from 'next/server'
import { requireAdmin } from '@/app/api/_shared/proxy'
import { isTrustedOrigin } from '@/lib/security/request-guards'
import { db } from '@/lib/backend/shared/database.module'
import { currentPerformance, detectGpu, savePerformanceMode } from '@/lib/backend/works/performance'
import { probeGpu } from '@/lib/server/manga-ocr-node'

export async function GET() {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  await detectGpu(probeGpu)
  return NextResponse.json(currentPerformance(db), { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request) {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  if (process.env.KOMA_DESKTOP !== '1' || !isTrustedOrigin(request)) return NextResponse.json({ message: 'Ação não autorizada.' }, { status: 403 })
  const { mode } = await request.json().catch(() => ({})) as { mode?: unknown }
  try { savePerformanceMode(db, mode) } catch { return NextResponse.json({ message: 'Perfil de desempenho inválido.' }, { status: 400 }) }
  await detectGpu(probeGpu)
  return NextResponse.json(currentPerformance(db))
}
