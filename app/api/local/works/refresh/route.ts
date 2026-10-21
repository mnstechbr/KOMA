import { NextResponse } from 'next/server'
import { personalAccess } from '../_shared'
import { worksRepository } from '@/lib/backend/works/repository'
import { startWorkAutomation } from '@/lib/backend/works/worker'
export async function POST(request: Request) {
  const auth = await personalAccess(request)
  if ('response' in auth) return auth.response
  const count = worksRepository.refreshAll(auth.user.id)
  startWorkAutomation()
  return NextResponse.json({ updated: count })
}
