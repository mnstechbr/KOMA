import { NextResponse } from 'next/server'
import { requireAdmin } from '@/app/api/_shared/proxy'
import { isTrustedOrigin } from '@/lib/security/request-guards'
import { db } from '@/lib/backend/shared/database.module'
import { localAddresses, mobileSettings, updateMobile } from '@/lib/backend/works/mobile'
import { qrSvg } from '@/lib/qr'

// "Ler no celular". O app desktop lê daqui se deve abrir o servidor da rede local
// (porta e código de acesso); a tela mostra o endereço e o QR code.
function view(settings: ReturnType<typeof mobileSettings>) {
  const addresses = localAddresses()
  const url = addresses[0] ? `http://${addresses[0]}:${settings.port}/?k=${settings.token}` : null
  return {
    ...settings,
    addresses: addresses.map((address) => `http://${address}:${settings.port}`),
    qr: settings.enabled && url ? qrSvg(url, 5) : null,
  }
}

export async function GET() {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  return NextResponse.json(view(mobileSettings(db)), { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request) {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  if (process.env.KOMA_DESKTOP !== '1' || !isTrustedOrigin(request))
    return NextResponse.json({ message: 'Ação não autorizada.' }, { status: 403 })
  const body = (await request.json().catch(() => ({}))) as { enabled?: unknown; renew?: unknown }
  return NextResponse.json(
    view(updateMobile(db, { enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined, renew: body.renew === true })),
  )
}
