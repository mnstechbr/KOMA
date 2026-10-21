import 'server-only'
import { cookies } from 'next/headers'
import { DEFAULT_UI_LANGUAGE, isUiLanguage, UI_LANGUAGE_COOKIE, type UiLanguage } from '@/lib/languages'
import { catalog } from './index'
import { translateWith, type Vars } from './core'

export async function uiLanguage(): Promise<UiLanguage> {
  const value = (await cookies()).get(UI_LANGUAGE_COOKIE)?.value
  return isUiLanguage(value) ? value : DEFAULT_UI_LANGUAGE
}

export async function serverT() {
  const lang = await uiLanguage()
  return (text: string, vars?: Vars) => translateWith(catalog, lang, text, vars)
}
