import { NextResponse } from 'next/server'
import { requireAdmin } from '@/app/api/_shared/proxy'
import { db } from '@/lib/backend/shared/database.module'
import { stageReport } from '@/lib/backend/works/stage-times'

// Tempo de cada etapa dos últimos capítulos preparados.
export async function GET() {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  return NextResponse.json(stageReport(db, auth.user.id), { headers: { 'Cache-Control': 'no-store' } })
}
