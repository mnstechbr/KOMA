import type Database from 'better-sqlite3'
import type { CatalogWork } from '@/lib/works'
import { sameLanguage, type UiLanguage } from '@/lib/languages'

// Sinopse e gêneros no idioma da interface. Primeiro a versão oferecida pela
// própria fonte; sem ela, uma tradução feita uma vez pelo modelo configurado
// e guardada na obra.

export const uiLanguageCode = (ui: UiLanguage) => ui === 'pt-BR' ? 'pt-br' : ui
const matches = (language: string, wanted: string) => sameLanguage(language || '', wanted) || (wanted === 'pt-br' && language === 'pt')

export function localizeMetadata(metadata: CatalogWork, ui: UiLanguage): CatalogWork {
  const wanted = uiLanguageCode(ui)
  const localized = metadata.localized?.[wanted]
  const fromSource = Object.entries(metadata.descriptions || {}).find(([language]) => matches(language, wanted))
  if (localized) return { ...metadata, description: fromSource?.[1] || localized.description || metadata.description, descriptionLanguage: wanted, genres: localized.genres.length ? localized.genres : metadata.genres }
  if (fromSource) return { ...metadata, description: fromSource[1], descriptionLanguage: fromSource[0] }
  return metadata
}

/** Gêneros da MangaDex vêm em inglês; só não precisam de tradução numa interface em inglês. */
export function needsLocalization(metadata: CatalogWork, ui: UiLanguage) {
  const wanted = uiLanguageCode(ui)
  if (metadata.localized?.[wanted]) return false
  const shown = localizeMetadata(metadata, ui)
  const description = Boolean(shown.description.trim()) && !matches(shown.descriptionLanguage, wanted)
  const genres = metadata.genres.length > 0 && wanted !== 'en'
  return description || genres
}

/** Divide a sinopse em parágrafos de até 4.000 caracteres para o tradutor. */
export function synopsisParts(text: string) {
  return text.split(/\n+/).map((part) => part.trim()).filter(Boolean).flatMap((part) => part.match(/[\s\S]{1,4000}/g) || [])
}

export type SynopsisTranslate = (texts: string[], source: string, target: string) => Promise<{ translations: string[] }>

/** Traduz a sinopse de uma obra que ainda não a tem no idioma da interface. Devolve o id ou null. */
export async function localizeNextWork(database: Database.Database, ui: UiLanguage, translate: SynopsisTranslate, skip: number[] = []) {
  const wanted = uiLanguageCode(ui)
  const rows = database.prepare('SELECT id, metadata_json FROM works ORDER BY last_opened_at DESC, id').all() as Array<{ id: number; metadata_json: string }>
  for (const row of rows) {
    if (skip.includes(row.id)) continue
    const metadata = JSON.parse(row.metadata_json) as CatalogWork
    if (!needsLocalization(metadata, ui)) continue
    const shown = localizeMetadata(metadata, ui)
    const parts = matches(shown.descriptionLanguage, wanted) ? [] : synopsisParts(shown.description)
    const genres = wanted === 'en' ? [] : metadata.genres.filter((genre) => genre.trim())
    const texts = [...parts, ...genres]
    const result = texts.length ? await translate(texts, shown.descriptionLanguage || 'auto', wanted) : { translations: [] }
    const translated = result.translations
    // Relê a obra: a lista de capítulos pode ter sido salva enquanto o modelo respondia.
    const current = database.prepare('SELECT metadata_json FROM works WHERE id=?').get(row.id) as { metadata_json: string } | undefined
    if (!current) return row.id
    const fresh = JSON.parse(current.metadata_json) as CatalogWork
    fresh.localized = { ...(fresh.localized || {}), [wanted]: { description: parts.length ? translated.slice(0, parts.length).join('\n\n') : '', genres: translated.slice(parts.length) } }
    database.prepare('UPDATE works SET metadata_json=? WHERE id=?').run(JSON.stringify(fresh), row.id)
    return row.id
  }
  return null
}
