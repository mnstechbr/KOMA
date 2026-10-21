import { NextResponse } from 'next/server'
import { requireAdmin } from '@/app/api/_shared/proxy'
import { isTrustedOrigin } from '@/lib/security/request-guards'
import { checkBridgeConnection } from '@/lib/backend/kpassword/bridge'
import { TranslationError } from '@/lib/backend/kpassword/settings'

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  if (process.env.KOMA_DESKTOP !== '1' || !isTrustedOrigin(request)) return NextResponse.json({ message: 'Verificação não autorizada.' }, { status: 403 })
  try { return NextResponse.json({ bridge: await checkBridgeConnection() }) }
  catch (error) { return NextResponse.json({ message: error instanceof TranslationError ? error.message : 'Não foi possível conectar ao KPassword.' }, { status: error instanceof TranslationError ? error.status : 503 }) }
}
