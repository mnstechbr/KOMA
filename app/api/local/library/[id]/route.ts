import { NextResponse } from 'next/server'
import { requireUser, unauthorizedResponse } from '@/app/api/_shared/proxy'
import { isTrustedOrigin } from '@/lib/security/request-guards'
import { updateLibraryPreference } from '@/lib/backend/sections/library-preferences'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  if (!user) return unauthorizedResponse()
  if (!isTrustedOrigin(request)) return NextResponse.json({ message: 'Origem não autorizada.' }, { status: 403 })
  const { id } = await params
  const sectionId = Number(id)
  const body = await request.json().catch(() => null)
  if (!Number.isInteger(sectionId) || sectionId < 1 || !body ||
    (typeof body.favorite !== 'boolean' && body.opened !== true)) {
    return NextResponse.json({ message: 'Preferência inválida.' }, { status: 400 })
  }
  const result = updateLibraryPreference(user.id, sectionId, {
    ...(typeof body.favorite === 'boolean' ? { favorite: body.favorite } : {}),
    ...(body.opened === true ? { opened: true } : {}),
  })
  return result ? NextResponse.json(result) : NextResponse.json({ message: 'Capítulo não encontrado.' }, { status: 404 })
}
