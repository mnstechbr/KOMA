import { NextResponse } from 'next/server'
import { db } from '@/lib/backend/shared/database.module'

export const dynamic = 'force-dynamic'

export function GET() {
  db.prepare('SELECT 1').get()
  return NextResponse.json({ application: 'KOMA', instance: process.env.KOMA_INSTANCE_ID || '', status: 'ok' }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
