// Idiomas da interface e idiomas para os quais o KOMA traduz as obras.
// Códigos em minúsculas, como as fontes informam (pt-br, en, es...).

export type UiLanguage = 'pt-BR' | 'en' | 'es'
export const UI_LANGUAGES: Array<{ code: UiLanguage; name: string }> = [
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
]
export const DEFAULT_UI_LANGUAGE: UiLanguage = 'pt-BR'
export const UI_LANGUAGE_COOKIE = 'koma-lang'
export function isUiLanguage(value: unknown): value is UiLanguage { return UI_LANGUAGES.some((item) => item.code === value) }

export type TargetLanguage = 'pt-br' | 'en' | 'es' | 'fr' | 'de' | 'it'
export interface TargetInfo { code: TargetLanguage; name: string; short: string; prompt: string }
// O desenho do texto nas páginas usa fontes latinas; por isso só idiomas latinos.
export const TARGET_LANGUAGES: TargetInfo[] = [
  { code: 'pt-br', name: 'Português (Brasil)', short: 'PT-BR', prompt: 'Brazilian Portuguese' },
  { code: 'en', name: 'English', short: 'EN', prompt: 'English' },
  { code: 'es', name: 'Español', short: 'ES', prompt: 'Spanish (neutral Latin American)' },
  { code: 'fr', name: 'Français', short: 'FR', prompt: 'French' },
  { code: 'de', name: 'Deutsch', short: 'DE', prompt: 'German' },
  { code: 'it', name: 'Italiano', short: 'IT', prompt: 'Italian' },
]
export const DEFAULT_TARGET: TargetLanguage = 'pt-br'
export function isTargetLanguage(value: unknown): value is TargetLanguage { return TARGET_LANGUAGES.some((item) => item.code === value) }
export function targetInfo(code: string | null | undefined): TargetInfo {
  const normalized = String(code || '').toLowerCase()
  return TARGET_LANGUAGES.find((item) => item.code === normalized || (normalized === 'pt' && item.code === 'pt-br')) || TARGET_LANGUAGES[0]
}
/** Um capítulo já está no idioma de destino? "es-la" conta como espanhol; "pt" (Portugal) não conta como pt-br. */
export function sameLanguage(chapterLanguage: string, target: string) {
  const language = chapterLanguage.toLowerCase(); const wanted = target.toLowerCase()
  return language === wanted || (!wanted.includes('-') && language.startsWith(`${wanted}-`))
}
/** Equivalente SQL de sameLanguage para colunas c.language e w.target_language. */
export const SAME_LANGUAGE_SQL = "(lower(c.language)=w.target_language OR (instr(w.target_language,'-')=0 AND lower(c.language) LIKE w.target_language||'-%'))"
