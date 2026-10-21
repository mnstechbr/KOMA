import { NextResponse } from 'next/server'
import { requireAdmin } from '@/app/api/_shared/proxy'
import { isTrustedOrigin } from '@/lib/security/request-guards'
import { connectSubscription, subscriptionStatus, type SubscriptionId } from '@/lib/backend/kpassword/subscriptions'

export async function GET() {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  return NextResponse.json({ subscriptions: await subscriptionStatus() }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  if (process.env.KOMA_DESKTOP !== '1' || !isTrustedOrigin(request)) return NextResponse.json({ message: 'Ação não autorizada.' }, { status: 403 })
  const { id } = await request.json().catch(() => ({})) as { id?: string }
  if (id !== 'claude-code' && id !== 'chatgpt-codex') return NextResponse.json({ message: 'Assinatura desconhecida.' }, { status: 400 })
  connectSubscription(id as SubscriptionId)
  return NextResponse.json({ started: true })
}
