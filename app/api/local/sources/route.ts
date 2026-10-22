import { NextResponse } from 'next/server'
import { requireAdmin } from '@/app/api/_shared/proxy'
import { isTrustedOrigin } from '@/lib/security/request-guards'
import { db } from '@/lib/backend/shared/database.module'
import {
  addCustomSource,
  connectorsDir,
  ensureSources,
  listCustomSources,
  localConnectors,
  removeCustomSource,
} from '@/lib/backend/works/custom-sources'
import { SourceError } from '@/lib/backend/works/source-http'

async function list() {
  await ensureSources(db, true)
  return {
    custom: listCustomSources(db).map(({ id, name, origin }) => ({ id, name, origin })),
    local: localConnectors().map(({ id, name }) => ({ id, name })),
    folder: connectorsDir(),
  }
}
async function guard(request?: Request) {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  if (request && (process.env.KOMA_DESKTOP !== '1' || !isTrustedOrigin(request)))
    return NextResponse.json({ message: 'Ação não autorizada.' }, { status: 403 })
  return null
}

export async function GET() {
  const denied = await guard()
  if (denied) return denied
  return NextResponse.json(await list(), { headers: { 'Cache-Control': 'no-store' } })
}

// Adiciona um site com o modelo Madara pelo link de uma obra.
export async function POST(request: Request) {
  const denied = await guard(request)
  if (denied) return denied
  const body = (await request.json().catch(() => ({}))) as { url?: unknown; name?: unknown }
  if (typeof body.url !== 'string' || body.url.length > 500)
    return NextResponse.json({ message: 'Cole o link de uma obra no site.' }, { status: 400 })
  try {
    const added = await addCustomSource(db, body.url, typeof body.name === 'string' ? body.name : undefined, request.signal)
    return NextResponse.json({ ...(await list()), added: { name: added.source.name, chapters: added.chapters } })
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof SourceError ? error.message : 'Não foi possível consultar o site.' },
      { status: 400 },
    )
  }
}

export async function DELETE(request: Request) {
  const denied = await guard(request)
  if (denied) return denied
  const body = (await request.json().catch(() => ({}))) as { id?: unknown }
  if (typeof body.id !== 'string' || !(await removeCustomSource(db, body.id)))
    return NextResponse.json({ message: 'Fonte não encontrada.' }, { status: 404 })
  return NextResponse.json(await list())
}
