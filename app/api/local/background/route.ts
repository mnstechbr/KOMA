import { NextResponse } from 'next/server'
import { requireAdmin } from '@/app/api/_shared/proxy'
import { isTrustedOrigin } from '@/lib/security/request-guards'
import { db } from '@/lib/backend/shared/database.module'
import { backgroundSettings, saveBackgroundSettings, takeNotices } from '@/lib/backend/works/background'

// Preferências da coleta em segundo plano. O app desktop lê daqui a bandeja, o
// início com o computador e os avisos de capítulo novo (?notices=1).
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  const settings = backgroundSettings(db)
  const notices = new URL(request.url).searchParams.get('notices') === '1' ? takeNotices(db) : undefined
  return NextResponse.json({ ...settings, notices }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request) {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  if (process.env.KOMA_DESKTOP !== '1' || !isTrustedOrigin(request))
    return NextResponse.json({ message: 'Ação não autorizada.' }, { status: 403 })
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const hour = body.checkHour
  if (hour !== undefined && hour !== null && !(Number.isInteger(hour) && (hour as number) >= 0 && (hour as number) <= 23))
    return NextResponse.json({ message: 'Horário inválido.' }, { status: 400 })
  return NextResponse.json(
    saveBackgroundSettings(db, {
      tray: typeof body.tray === 'boolean' ? body.tray : undefined,
      autostart: typeof body.autostart === 'boolean' ? body.autostart : undefined,
      notify: typeof body.notify === 'boolean' ? body.notify : undefined,
      checkHour: hour as number | null | undefined,
    }),
  )
}
