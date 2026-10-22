import { NextResponse } from 'next/server'
import { requireUser, unauthorizedResponse } from '@/app/api/_shared/proxy'
import { isTrustedOrigin } from '@/lib/security/request-guards'
import { clearDeeplKey, deeplKey, deeplUsage, saveDeeplKey } from '@/lib/backend/kpassword/deepl-free'

// Chave do DeepL API Free usada pelo tradutor "DeepL". A chave nunca volta para a tela.
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
  const apiKey = deeplKey()
  const usage = apiKey ? await deeplUsage(apiKey) : null
  return NextResponse.json({ hasApiKey: Boolean(apiKey), isValid: Boolean(usage), usage }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request) {
  const denied = await owner(request)
  if (denied) return denied
  const body = (await request.json().catch(() => ({}))) as { apiKey?: unknown }
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  if (!apiKey || apiKey.length > 200) return NextResponse.json({ message: 'Informe a chave do DeepL API Free.' }, { status: 400 })
  if (!apiKey.endsWith(':fx'))
    return NextResponse.json(
      { message: 'Essa não é uma chave do plano gratuito. A chave do DeepL API Free termina em :fx.' },
      { status: 400 },
    )
  const usage = await deeplUsage(apiKey)
  if (!usage) return NextResponse.json({ message: 'O DeepL não aceitou essa chave.' }, { status: 401 })
  saveDeeplKey(apiKey)
  return NextResponse.json({ message: 'Chave do DeepL salva.', hasApiKey: true, isValid: true, usage })
}

export async function DELETE(request: Request) {
  const denied = await owner(request)
  if (denied) return denied
  clearDeeplKey()
  return NextResponse.json({ message: 'Chave do DeepL removida.', hasApiKey: false, isValid: false, usage: null })
}
