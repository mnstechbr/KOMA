import { NextResponse } from 'next/server'
import { createDesktopSession, isDesktopBootstrapAuthorized } from '@/lib/backend/auth/desktop-profile'
import { db } from '@/lib/backend/shared/database.module'
import { getLanguageSettings } from '@/lib/backend/shared/language-settings'

export async function POST(request: Request) {
  if (!isDesktopBootstrapAuthorized(request)) {
    return NextResponse.json({ message: 'Inicialização exclusiva do aplicativo KOMA.' }, { status: 403 })
  }
  // O aplicativo usa o idioma salvo para o cookie da interface e o menu da janela.
  return NextResponse.json(
    { ...createDesktopSession(), language: getLanguageSettings(db).ui },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
