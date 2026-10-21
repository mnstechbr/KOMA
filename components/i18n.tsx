'use client'

import { createContext, useCallback, useContext, type ReactNode } from 'react'
import { DEFAULT_UI_LANGUAGE, type UiLanguage } from '@/lib/languages'
import { catalog } from '@/lib/i18n'
import { translateWith, type Vars } from '@/lib/i18n/core'

const LanguageContext = createContext<UiLanguage>(DEFAULT_UI_LANGUAGE)

export function I18nProvider({ lang, children }: { lang: UiLanguage; children: ReactNode }) {
  return <LanguageContext.Provider value={lang}>{children}</LanguageContext.Provider>
}

/** t("Texto em português", { n: 3 }) devolve o texto no idioma da interface. */
export function useT() {
  const lang = useContext(LanguageContext)
  const t = useCallback((text: string, vars?: Vars) => translateWith(catalog, lang, text, vars), [lang])
  return { t, lang, locale: lang === 'pt-BR' ? 'pt-BR' : lang === 'es' ? 'es' : 'en' }
}
