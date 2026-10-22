'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownUp, Check, Heart, Loader2, Plus, RefreshCw, Search, X } from 'lucide-react'
import { buildImageViewUrl, type SectionListItem } from '@/lib/sections'
import { useT } from '@/components/i18n'

type LibraryItem = SectionListItem & { favorite: boolean; read: boolean }
type LibrarySnapshot = { items: LibraryItem[]; lastOpenedId: number | null }
type Filter = 'all' | 'favorites' | 'unread' | 'read'

const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'favorites', label: 'Favoritos' },
  { value: 'unread', label: 'Não lidos' },
  { value: 'read', label: 'Lidos' },
]
const languages: Record<string, string> = {
  ja: 'Japonês',
  ko: 'Coreano',
  zh: 'Chinês',
  'zh-CN': 'Chinês simplificado',
  'zh-TW': 'Chinês tradicional',
  en: 'Inglês',
  auto: 'Idioma automático',
}

function cover(item: LibraryItem) {
  return item.cover?.image_id ? buildImageViewUrl(item.id, item.cover.image_id, 'original') : null
}
function processing(item: LibraryItem) {
  return item.processing_images_count > 0 || item.internal_status === 'processing'
}

export function DesktopLibrary() {
  const { t, locale } = useT()
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>({ items: [], lastOpenedId: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState('recent')
  const [pendingFavorites, setPendingFavorites] = useState<Set<number>>(new Set())
  const inFlight = useRef<{ signal?: AbortSignal } | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (inFlight.current && !inFlight.current.signal?.aborted) return
      const request = { signal }
      inFlight.current = request
      try {
        const response = await fetch('/api/local/library', { cache: 'no-store', signal })
        if (!response.ok)
          throw new Error(
            response.status === 401 ? t('Reabra o KOMA para recuperar a sessão local.') : t('Não foi possível carregar a biblioteca.'),
          )
        const data = (await response.json()) as LibrarySnapshot
        if (!signal?.aborted) {
          setSnapshot(data)
          setError('')
        }
      } catch (error) {
        if (!signal?.aborted) setError(error instanceof Error ? error.message : t('Erro ao carregar a biblioteca.'))
      } finally {
        if (inFlight.current === request) inFlight.current = null
        if (!signal?.aborted) setLoading(false)
      }
    },
    [t],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void load(controller.signal)
    }, 30000)
    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [load])

  const items = snapshot.items
  const counts = {
    all: items.length,
    favorites: items.filter((item) => item.favorite).length,
    unread: items.filter((item) => !item.read).length,
    read: items.filter((item) => item.read).length,
  }
  const pages = items.reduce((sum, item) => sum + item.images_count, 0)
  const activeJobs = items.filter(processing).length
  const visible = useMemo(() => {
    const normalized = query
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase(locale)
    return items
      .filter((item) => {
        const name = item.name
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLocaleLowerCase(locale)
        return (
          name.includes(normalized) &&
          (filter === 'all' || (filter === 'favorites' ? item.favorite : filter === 'read' ? item.read : !item.read))
        )
      })
      .sort((a, b) => (sort === 'title' ? a.name.localeCompare(b.name, locale) : sort === 'oldest' ? a.id - b.id : b.id - a.id))
  }, [items, query, filter, sort, locale])

  async function toggleFavorite(item: LibraryItem) {
    setPendingFavorites((previous) => new Set(previous).add(item.id))
    try {
      const response = await fetch(`/api/local/library/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorite: !item.favorite }),
      })
      if (!response.ok) throw new Error(t('Não foi possível salvar o favorito.'))
      const state = (await response.json()) as { favorites: number[] }
      setSnapshot((previous) => ({
        ...previous,
        items: previous.items.map((entry) => ({ ...entry, favorite: state.favorites.includes(entry.id) })),
      }))
      setError('')
    } catch (error) {
      setError(error instanceof Error ? error.message : t('Erro ao salvar favorito.'))
    } finally {
      setPendingFavorites((previous) => {
        const next = new Set(previous)
        next.delete(item.id)
        return next
      })
    }
  }

  function rememberOpening(id: number) {
    void fetch(`/api/local/library/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opened: true }),
      keepalive: true,
    }).catch(() => {
      /* A navegação continua mesmo se o registro da última abertura falhar. */
    })
  }

  return (
    <div data-library-state={loading ? 'loading' : error ? 'error' : 'ready'}>
      <Link href="/inicio/secoes" className="koma-text-link koma-back">
        {t('← Biblioteca')}
      </Link>
      <header className="koma-page-head">
        <div>
          <h1>{t('Importações avulsas')}</h1>
          <p>
            {t('Capítulos que você trouxe de arquivos do computador.')}{' '}
            {counts.all === 1 ? t('1 capítulo') : t('{n} capítulos', { n: counts.all })} ·{' '}
            {pages === 1 ? t('1 página') : t('{n} páginas', { n: pages })}
            {activeJobs ? ` · ${t('{n} em processamento', { n: activeJobs })}` : ''}.
          </p>
        </div>
        <div className="koma-page-tools">
          <label className="koma-search">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">{t('Buscar nas importações')}</span>
            <input type="search" placeholder={t('Buscar uma história…')} value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <Link href="/inicio/secoes/nova" className="koma-button">
            <Plus size={18} aria-hidden="true" />
            {t('Importar arquivos')}
          </Link>
        </div>
      </header>
      <div className="koma-shelf-head">
        <div className="koma-filters" role="group" aria-label={t('Filtrar importações')}>
          {filters.map((entry) => (
            <button
              key={entry.value}
              type="button"
              className="koma-pill"
              aria-pressed={filter === entry.value}
              onClick={() => setFilter(entry.value)}
            >
              {t(entry.label)}
              <span>{counts[entry.value]}</span>
            </button>
          ))}
        </div>
        <div className="koma-filters">
          <label className="koma-pill">
            <ArrowDownUp size={15} aria-hidden="true" />
            <span className="sr-only">{t('Ordenar')}</span>
            <select className="bg-transparent" value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="recent">{t('Mais recentes')}</option>
              <option value="title">{t('Título: A–Z')}</option>
              <option value="oldest">{t('Mais antigos')}</option>
            </select>
          </label>
          <button type="button" className="koma-pill" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            {t('Atualizar')}
          </button>
        </div>
      </div>
      {error ? (
        <div role="alert" className="koma-alert mb-4 flex justify-between gap-4">
          {error}
          <button className="koma-text-link" onClick={() => void load()}>
            {t('Tentar novamente')}
          </button>
        </div>
      ) : null}
      {loading ? (
        <div className="koma-book-grid" aria-busy="true" aria-label={t('Carregando importações')}>
          {[1, 2, 3, 4].map((id) => (
            <div key={id} className="koma-cover-skeleton" />
          ))}
        </div>
      ) : visible.length ? (
        <div className="koma-book-grid">
          {visible.map((item, index) => {
            const image = cover(item)
            return (
              <article className="koma-book" key={item.id} style={{ animationDelay: `${Math.min(index, 7) * 35}ms` }}>
                <div className="koma-book-cover">
                  <Link
                    href={`/inicio/secoes/${item.id}`}
                    onClick={() => rememberOpening(item.id)}
                    aria-label={t('Ler {name}', { name: item.name })}
                  >
                    {image ? (
                      <Image src={image} alt={t('Capa de {title}', { title: item.name })} fill sizes="(max-width: 760px) 45vw, 240px" />
                    ) : (
                      <span className="koma-cover-placeholder" aria-hidden="true">
                        コマ
                      </span>
                    )}
                  </Link>
                  <button
                    className="koma-favorite"
                    onClick={() => void toggleFavorite(item)}
                    disabled={pendingFavorites.has(item.id)}
                    aria-pressed={item.favorite}
                    aria-label={
                      item.favorite
                        ? t('Remover {name} dos favoritos', { name: item.name })
                        : t('Adicionar {name} aos favoritos', { name: item.name })
                    }
                  >
                    <Heart size={18} fill={item.favorite ? 'currentColor' : 'none'} aria-hidden="true" />
                  </button>
                  {item.read ? (
                    <span className="koma-stamp is-ink">
                      <Check size={12} aria-hidden="true" />
                      {t('Lido')}
                    </span>
                  ) : processing(item) ? (
                    <span className="koma-stamp is-paper">
                      <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                      {t('Processando')}
                    </span>
                  ) : null}
                </div>
                <p className="koma-book-kind">{languages[item.source_lang] ? t(languages[item.source_lang]) : item.source_lang}</p>
                <h3>
                  <Link href={`/inicio/secoes/${item.id}`} onClick={() => rememberOpening(item.id)}>
                    {item.name}
                  </Link>
                </h3>
                <p className="koma-book-meta">
                  {item.images_count === 1 ? t('1 página') : t('{n} páginas', { n: item.images_count })}
                  {item.read ? ` · ${t('leitura concluída')}` : ''}
                </p>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="koma-empty">
          <h2>{items.length ? t('Nenhuma história por aqui.') : t('Nenhuma importação ainda.')}</h2>
          <p>{items.length ? t('Experimente outro título ou filtro.') : t('Importe páginas que você já tem no computador.')}</p>
          {items.length ? (
            <button
              className="koma-text-link"
              onClick={() => {
                setQuery('')
                setFilter('all')
              }}
            >
              <X size={16} aria-hidden="true" />
              {t('Limpar filtros')}
            </button>
          ) : (
            <Link href="/inicio/secoes/nova" className="koma-outline-button">
              <Plus size={16} aria-hidden="true" />
              {t('Importar arquivos')}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
