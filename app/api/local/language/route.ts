import { NextResponse } from 'next/server'
import { requireAdmin } from '@/app/api/_shared/proxy'
import { isTrustedOrigin } from '@/lib/security/request-guards'
import { db } from '@/lib/backend/shared/database.module'
import { getLanguageSettings, saveLanguageSettings } from '@/lib/backend/shared/language-settings'
import { UI_LANGUAGE_COOKIE } from '@/lib/languages'

export async function GET() {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  return NextResponse.json(getLanguageSettings(db), { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request) {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  if (process.env.KOMA_DESKTOP !== '1' || !isTrustedOrigin(request)) return NextResponse.json({ message: 'Ação não autorizada.' }, { status: 403 })
  try {
    const settings = saveLanguageSettings(db, await request.json().catch(() => ({})))
    const response = NextResponse.json(settings)
    // O idioma da interface também vai num cookie, lido ao montar cada tela.
    response.cookies.set(UI_LANGUAGE_COOKIE, settings.ui, { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 10 * 365 * 24 * 3600 })
    return response
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Idioma inválido.' }, { status: 400 })
  }
}
