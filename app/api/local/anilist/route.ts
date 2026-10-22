import { NextResponse } from 'next/server'
import { requireAdmin } from '@/app/api/_shared/proxy'
import { isTrustedOrigin } from '@/lib/security/request-guards'
import { db } from '@/lib/backend/shared/database.module'
import { anilistStatus, connectAniList, disconnectAniList, saveClientId, syncAniListAll } from '@/lib/backend/works/anilist'

// Progresso de leitura no AniList (opcional). O token nunca volta para a tela.
async function guard(request?: Request) {
  const auth = await requireAdmin()
  if ('response' in auth) return { response: auth.response }
  if (request && (process.env.KOMA_DESKTOP !== '1' || !isTrustedOrigin(request))) return { response: NextResponse.json({ message: 'Ação não autorizada.' }, { status: 403 }) }
  return { userId: auth.user.id }
}

export async function GET() {
  const auth = await guard()
  if ('response' in auth) return auth.response
  return NextResponse.json(anilistStatus(db), { headers: { 'Cache-Control': 'no-store' } })
}

// { clientId } guarda o ID do cliente; { token } conecta; { sync: true } envia o progresso de todas as obras.
export async function POST(request: Request) {
  const auth = await guard(request)
  if ('response' in auth) return auth.response
  const body = await request.json().catch(() => ({})) as { clientId?: unknown; token?: unknown; sync?: unknown }
  try {
    if (typeof body.clientId === 'string') saveClientId(db, body.clientId.trim())
    if (typeof body.token === 'string') await connectAniList(db, body.token)
    const synced = body.sync === true ? await syncAniListAll(db, auth.userId!) : undefined
    return NextResponse.json({ ...anilistStatus(db), synced })
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Não foi possível falar com o AniList.' }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  const auth = await guard(request)
  if ('response' in auth) return auth.response
  disconnectAniList(db)
  return NextResponse.json(anilistStatus(db))
}
