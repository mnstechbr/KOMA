import type { UiLanguage } from '@/lib/languages'

// Tradução da interface: o texto em português é a própria chave. Cada arquivo
// em messages/ traz as versões em inglês e espanhol dos textos de uma tela.
// Texto sem tradução aparece em português, nunca vazio.
export type Messages = Record<string, string>
export interface Catalog {
  en: Messages
  es: Messages
}
export type Vars = Record<string, string | number>

export function format(text: string, vars?: Vars) {
  return vars ? text.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match)) : text
}

export function mergeCatalogs(...catalogs: Catalog[]): Catalog {
  return { en: Object.assign({}, ...catalogs.map((item) => item.en)), es: Object.assign({}, ...catalogs.map((item) => item.es)) }
}

export function translateWith(catalog: Catalog, lang: UiLanguage, text: string, vars?: Vars) {
  const table = lang === 'en' ? catalog.en : lang === 'es' ? catalog.es : null
  return format(table?.[text] ?? text, vars)
}
