import { NextResponse } from 'next/server'
import { requireAdmin } from '@/app/api/_shared/proxy'
import { isTrustedOrigin } from '@/lib/security/request-guards'
import { closeBridge, inspectBridge } from '@/lib/backend/kpassword/bridge'
import { getTranslationSettings, saveTranslationSettings } from '@/lib/backend/kpassword/repository'
import { TranslationError } from '@/lib/backend/kpassword/settings'

export const runtime = 'nodejs'

export async function GET() {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  return NextResponse.json({ desktop: process.env.KOMA_DESKTOP === '1', settings: getTranslationSettings(), bridge: await inspectBridge() }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request) {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  if (process.env.KOMA_DESKTOP !== '1' || !isTrustedOrigin(request)) return NextResponse.json({ message: 'Alteração não autorizada.' }, { status: 403 })
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw) > 32000) return NextResponse.json({ message: 'Configuração muito extensa.' }, { status: 413 })
    const settings = saveTranslationSettings(JSON.parse(raw))
    closeBridge()
    return NextResponse.json({ settings }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ message: error instanceof TranslationError ? error.message : 'Configuração inválida.' }, { status: error instanceof TranslationError ? error.status : 400 })
  }
}
