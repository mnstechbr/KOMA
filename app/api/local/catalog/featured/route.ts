import { NextResponse } from 'next/server'
import { personalAccess } from '../../works/_shared'
import { featuredCatalog } from '@/lib/backend/works/mangadex'
import { worksRepository } from '@/lib/backend/works/repository'
import type { CatalogWork } from '@/lib/works'

// Tela de busca vazia: obras mais seguidas e atualizadas recentemente no MangaDex,
// guardadas por 6 horas para a tela abrir na hora.
const TTL = 6 * 3600000
export async function GET(request: Request) {
  const auth = await personalAccess()
  if ('response' in auth) return auth.response
  const database = worksRepository.database
  const lists: Record<'popular' | 'recent', CatalogWork[]> = { popular: [], recent: [] }
  for (const kind of ['popular', 'recent'] as const) {
    const key = `koma:featured:v1:${kind}`
    const row = database.prepare('SELECT value FROM kv_store WHERE key=?').get(key) as { value: string } | undefined
    let cached: { at: number; works: CatalogWork[] } | null = null
    try { cached = row ? JSON.parse(row.value) : null } catch { cached = null }
    if (cached && Date.now() - cached.at < TTL) { lists[kind] = cached.works; continue }
    try {
      const works = await featuredCatalog(kind, request.signal)
      works.forEach((work) => worksRepository.cache(work))
      database.prepare('INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify({ at: Date.now(), works }))
      lists[kind] = works
    } catch { lists[kind] = cached?.works || [] }
  }
  return NextResponse.json(lists, { headers: { 'Cache-Control': 'no-store' } })
}
