import type Database from 'better-sqlite3'
import { decryptSecret, encryptSecret } from '@/lib/security/secrets'
import { normalizeTitle, type CatalogWork } from '@/lib/works'
import { searchTitles } from './aggregators'

// Progresso de leitura no AniList (opcional), pelo OAuth oficial: a pessoa
// autoriza o KOMA no site do AniList e cola o token que ele mostra. Nenhuma senha
// passa pelo KOMA; o token fica criptografado. Ao marcar um capítulo como lido, o
// AniList recebe o maior capítulo lido da obra (só aumenta, nunca diminui).
const KEY = 'koma:anilist:v1'
const MAP_KEY = 'koma:anilist-map:v1'
const API = 'https://graphql.anilist.co'
// ID público do cliente KOMA no AniList (redirecionamento para a página do token).
export const DEFAULT_CLIENT_ID = ''

interface Stored {
  clientId?: string
  token?: string
  viewer?: string
}
const read = (database: Database.Database, key: string) => {
  const row = database.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined
  try {
    return row ? JSON.parse(row.value) : {}
  } catch {
    return {}
  }
}
const write = (database: Database.Database, key: string, value: unknown) =>
  database
    .prepare(
      `INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = NULL`,
    )
    .run(key, JSON.stringify(value))

function stored(database: Database.Database): Stored {
  return read(database, KEY) as Stored
}
function token(database: Database.Database) {
  const value = stored(database).token
  return value ? decryptSecret(value) || '' : ''
}
export function anilistClientId(database: Database.Database) {
  return stored(database).clientId || DEFAULT_CLIENT_ID
}
export function authorizeUrl(clientId: string) {
  return clientId ? `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token` : null
}
export function anilistStatus(database: Database.Database) {
  const value = stored(database)
  const clientId = anilistClientId(database)
  return { connected: Boolean(value.token), viewer: value.viewer || null, clientId, authorizeUrl: authorizeUrl(clientId) }
}
export function saveClientId(database: Database.Database, clientId: string) {
  if (!/^\d{1,10}$/.test(clientId)) throw new Error('O ID do cliente do AniList é um número.')
  write(database, KEY, { ...stored(database), clientId })
}
export function disconnectAniList(database: Database.Database) {
  const { clientId } = stored(database)
  write(database, KEY, clientId ? { clientId } : {})
}

async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  accessToken?: string,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const response = await fetcher(API, {
    method: 'POST',
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  })
  const body = (await response.json().catch(() => ({}))) as { data?: T; errors?: Array<{ message?: string; status?: number }> }
  if (!response.ok || body.errors?.length || !body.data)
    throw new Error(
      response.status === 401 || body.errors?.some((error) => error.status === 401) ? 'unauthorized' : `AniList ${response.status}`,
    )
  return body.data
}

/** Confere o token colado pela pessoa e guarda criptografado. */
export async function connectAniList(database: Database.Database, accessToken: string, fetcher: typeof fetch = fetch) {
  const value = accessToken.trim()
  if (!/^[\w.-]{20,4000}$/.test(value)) throw new Error('Cole o token que o AniList mostrou depois de autorizar.')
  const data = await graphql<{ Viewer: { name: string } }>('query { Viewer { name } }', {}, value, fetcher).catch(() => null)
  if (!data?.Viewer?.name) throw new Error('O AniList não aceitou esse token.')
  write(database, KEY, { ...stored(database), token: encryptSecret(value), viewer: data.Viewer.name })
  return data.Viewer.name
}

/** Obra do AniList: o vínculo do MangaDex quando existe; senão, o título idêntico. */
async function mediaId(database: Database.Database, workId: number, fetcher: typeof fetch) {
  const map = read(database, MAP_KEY) as Record<string, number | null>
  if (workId in map) return map[workId]
  const row = database.prepare('SELECT metadata_json FROM works WHERE id=?').get(workId) as { metadata_json: string } | undefined
  if (!row) return null
  const metadata = JSON.parse(row.metadata_json) as CatalogWork
  let found: number | null = metadata.trackers?.al && /^\d+$/.test(metadata.trackers.al) ? Number(metadata.trackers.al) : null
  if (!found) {
    const titles = searchTitles(metadata)
    const known = new Set(titles.map((title) => normalizeTitle(title)))
    for (const title of titles.slice(0, 3)) {
      const data = await graphql<{ Page: { media: Array<{ id: number; title: Record<string, string | null>; synonyms: string[] }> } }>(
        'query ($search: String) { Page(perPage: 10) { media(search: $search, type: MANGA) { id title { romaji english native } synonyms } } }',
        { search: title },
        undefined,
        fetcher,
      )
      const match = data.Page.media.find((media) =>
        [...Object.values(media.title), ...(media.synonyms || [])].some((name) => name && known.has(normalizeTitle(name))),
      )
      if (match) {
        found = match.id
        break
      }
    }
  }
  write(database, MAP_KEY, { ...map, [workId]: found })
  return found
}

/** Envia ao AniList o maior capítulo lido da obra, se for maior que o de lá. */
export async function syncAniListWork(database: Database.Database, workId: number, fetcher: typeof fetch = fetch) {
  const accessToken = token(database)
  if (!accessToken) return 'disconnected'
  const done = database
    .prepare('SELECT number FROM work_chapters WHERE work_id=? AND read_done=1 AND number IS NOT NULL')
    .all(workId) as Array<{ number: string }>
  const progress = Math.max(0, ...done.map((row) => Math.floor(Number(row.number))).filter(Number.isFinite))
  if (!progress) return 'nothing'
  const id = await mediaId(database, workId, fetcher)
  if (!id) return 'not_found'
  try {
    const current = await graphql<{ Media: { mediaListEntry: { progress: number; status: string } | null } }>(
      'query ($id: Int) { Media(id: $id, type: MANGA) { mediaListEntry { progress status } } }',
      { id },
      accessToken,
      fetcher,
    )
    const entry = current.Media.mediaListEntry
    if (entry && (entry.progress >= progress || entry.status === 'COMPLETED')) return 'up_to_date'
    await graphql(
      'mutation ($id: Int, $progress: Int) { SaveMediaListEntry(mediaId: $id, progress: $progress, status: CURRENT) { id } }',
      { id, progress },
      accessToken,
      fetcher,
    )
    return 'updated'
  } catch (error) {
    if (error instanceof Error && error.message === 'unauthorized') {
      disconnectAniList(database)
      return 'disconnected'
    }
    throw error
  }
}

export async function syncAniListAll(database: Database.Database, userId: number, fetcher: typeof fetch = fetch) {
  const works = database.prepare('SELECT id FROM works WHERE user_id=?').all(userId) as Array<{ id: number }>
  const result = { updated: 0, notFound: 0 }
  for (const work of works) {
    const status = await syncAniListWork(database, work.id, fetcher).catch(() => 'error')
    if (status === 'updated') result.updated++
    if (status === 'not_found') result.notFound++
    if (status === 'disconnected') break
  }
  return result
}
