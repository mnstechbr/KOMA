import { NextResponse } from 'next/server'
import { openRouterService } from '@/lib/backend/openrouter/openrouter.module'
import { requireUser, unauthorizedResponse } from '@/app/api/_shared/proxy'
import { isTrustedOrigin } from '@/lib/security/request-guards'

// Chave do OpenRouter usada pelo tradutor "OpenRouter". A chave nunca volta para a tela.
async function owner(request?: Request) {
  if (request && !isTrustedOrigin(request)) return NextResponse.json({ message: 'Origem não autorizada.' }, { status: 403 })
  const user = await requireUser()
  if (!user) return unauthorizedResponse()
  if (user.role !== 4) return NextResponse.json({ message: 'Acesso negado.' }, { status: 403 })
  return null
}

export async function GET() {
  const denied = await owner()
  if (denied) return denied
  return NextResponse.json(await openRouterService.getStatus())
}

export async function PUT(request: Request) {
  const denied = await owner(request)
  if (denied) return denied
  const body = await request.json().catch(() => ({})) as { apiKey?: unknown }
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  if (!apiKey) return NextResponse.json({ message: 'Informe a chave do OpenRouter.' }, { status: 400 })
  if (!await openRouterService.saveApiKey(apiKey)) return NextResponse.json({ message: 'O OpenRouter não aceitou essa chave.' }, { status: 401 })
  return NextResponse.json({ message: 'Chave do OpenRouter salva.', hasApiKey: true, isValid: true })
}

export async function DELETE(request: Request) {
  const denied = await owner(request)
  if (denied) return denied
  openRouterService.clear()
  return NextResponse.json({ message: 'Chave do OpenRouter removida.', hasApiKey: false, isValid: false })
}
