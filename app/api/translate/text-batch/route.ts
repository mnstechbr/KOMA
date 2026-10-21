import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/backend/shared/database.module'
import { getLanguageSettings } from '@/lib/backend/shared/language-settings'
import { requireUser, unauthorizedResponse } from '@/app/api/_shared/proxy'
import { contextualTranslation } from '@/lib/backend/kpassword/translation'
import { TranslationError } from '@/lib/backend/kpassword/settings'
import { isTrustedOrigin } from '@/lib/security/request-guards'

const MAX_BATCH_ITEMS = 300
const MAX_TEXT_LENGTH = 5000

// Tradução de falas avulsas (teste das Preferências e importações) com o mesmo
// tradutor das obras.
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) return unauthorizedResponse()
    if (!isTrustedOrigin(request)) return NextResponse.json({ message: 'Origem não autorizada.' }, { status: 403 })
    if (process.env.KOMA_DESKTOP !== '1' || user.role !== 4) return NextResponse.json({ message: 'A tradução requer o perfil pessoal desktop.' }, { status: 403 })
    const payload = (await request.json()) as { source_lang?: unknown; target_lang?: unknown; texts?: unknown }
    const texts = payload.texts
    if (!Array.isArray(texts) || !texts.length || texts.length > MAX_BATCH_ITEMS || texts.some((text) => typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT_LENGTH)) {
      return NextResponse.json({ message: 'Envie até 300 falas não vazias de até 5.000 caracteres, sem truncamento.' }, { status: 400 })
    }
    const sourceLang = typeof payload.source_lang === 'string' && payload.source_lang.trim() ? payload.source_lang.trim() : 'auto'
    // Sem idioma informado, usa o idioma de tradução escolhido nas Preferências.
    const targetLang = typeof payload.target_lang === 'string' && payload.target_lang.trim() ? payload.target_lang.trim() : getLanguageSettings(db).target
    const result = await contextualTranslation.translate(texts as string[], sourceLang, targetLang)
    return NextResponse.json({ translations: result.translations, steps: result.steps, prompt_version: result.promptVersion, source_lang: sourceLang, target_lang: targetLang })
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof TranslationError ? error.message : 'Erro ao traduzir. Confira o tradutor nas Preferências.', ...(error instanceof TranslationError ? { code: error.code } : {}) },
      { status: error instanceof TranslationError ? error.status : 500 }
    )
  }
}
