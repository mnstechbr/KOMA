import { NextResponse } from 'next/server'
import { requireAdmin } from '@/app/api/_shared/proxy'
import { isTrustedOrigin } from '@/lib/security/request-guards'
import { SourceError } from '@/lib/backend/works/source-http'

export async function personalAccess(request?: Request) {
  const auth = await requireAdmin()
  if ('response' in auth) return auth
  if (process.env.KOMA_DESKTOP !== '1' || (request && !isTrustedOrigin(request)))
    return { response: NextResponse.json({ message: 'Operação não autorizada.' }, { status: 403 }) }
  return auth
}
export function sourceFailure(error: unknown) {
  return NextResponse.json(
    { message: error instanceof SourceError ? error.message : 'Não foi possível consultar a fonte agora. Tente novamente.' },
    { status: error instanceof SourceError && !error.retryable ? 400 : 502 },
  )
}
export function numericId(value: string) {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0
}
