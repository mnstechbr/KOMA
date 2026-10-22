export interface CatalogWork {
  /** "mangadex" ou o identificador de uma fonte personalizada. */
  source: string; sourceName?: string; sourceId: string; title: string; originalTitle: string
  aliases: Array<{ language: string; title: string }>
  description: string; descriptionLanguage: string; originalLanguage: string
  publicationLinks?: Array<{ kind: 'original' | 'licensed'; url: string }>
  /** IDs da obra no AniList e no MyAnimeList, quando a fonte informa. */
  trackers?: { al?: string; mal?: string }
  authors: string[]; genres: string[]; year: number | null; coverFile: string | null; coverSourceUrl?: string
  /** Sinopses da fonte por idioma (quando a fonte oferece várias). */
  descriptions?: Record<string, string>
  /** Sinopse e gêneros traduzidos pelo KOMA para o idioma da interface. */
  localized?: Record<string, { description: string; genres: string[] }>
}
export interface SourceChapter {
  sourceId: string; key: string; title: string; number: string | null; volume: string | null
  alternatives?: SourceChapter[]
  language: string; position: number; pageCount: number
}
export interface WorkSummary {
  id: number; title: string; sourceId: string; metadata: CatalogWork; favorite: boolean; paused: boolean
  stage: string; message: string; syncRequested: boolean; lastSyncedAt: string | null
  coverUrl: string | null
  // Idioma para o qual a obra é traduzida (works.target_language: 'pt-br', 'en', 'es'…).
  targetLanguage: string
  /** Páginas com leitura e desenho sendo refeitos (revisão de qualidade). */
  revisionPending: number
  downloadedPages: number; downloadedChapters: number; translationWait: { retryAt: number; code: string; message: string; manual: boolean } | null
  totalChapters: number; readyChapters: number; readChapters: number; totalPages: number; preparedPages: number
  // Leitura: próximo capítulo pronto e quantos prontos existem depois do último lido.
  lastOpenedAt: string | null; unreadReady: number
  nextChapter: { id: number; number: string | null; title: string } | null
}
export interface WorkChapter extends SourceChapter {
  id: number; state: string; message: string; sectionId: number | null; readyPages: number; read: boolean; createdAt: string
}
export const preparationLabels: Record<string, string> = {
  discovering: 'Buscando capítulos', queued: 'Na fila', downloading: 'Baixando páginas',
  ocr: 'Reconhecendo diálogos', translating: 'Traduzindo e revisando', ready: 'Pronto para ler',
  partial: 'Leitura com pendências', rendering: 'Desenhando páginas traduzidas',
  downloaded: 'Originais baixados · aguardando tradução', blocked: 'Tradução aguardando liberação', paused: 'Pausado', error: 'Precisa de atenção',
}
export function normalizeTitle(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}
export function titleScore(work: CatalogWork, query: string) {
  const needle = normalizeTitle(query)
  const tokens = needle.split(' ').filter(Boolean)
  return Math.max(...[work.title, work.originalTitle, ...work.aliases.map((alias) => alias.title)].map((title) => {
    const value = normalizeTitle(title)
    if (value === needle) return 1000
    if (value.replace(/^the /, '') === needle.replace(/^the /, '')) return 950
    return tokens.filter((token) => value.split(' ').includes(token)).length * 50 - Math.abs(value.length - needle.length)
  }))
}
