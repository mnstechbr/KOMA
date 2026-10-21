'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { BookOpen, Heart, Loader2, Plus, RefreshCw, Search } from 'lucide-react'
import { normalizeTitle, type WorkSummary } from '@/lib/works'
import { BrushProgress, WorkCover, chapterLabel, workKind, type Translate } from '@/components/koma-ui'
import { useT } from '@/components/i18n'

type Filter = 'all' | 'news' | 'favorites' | 'preparing'
const preparing = (work: WorkSummary) => work.syncRequested || work.readyChapters < work.totalChapters
const hasNews = (work: WorkSummary) => work.readChapters > 0 && work.unreadReady > 0

function stamp(work: WorkSummary, t: Translate) {
  if (work.syncRequested) return { text: t('Buscando'), tone: 'is-ink' }
  if (hasNews(work)) return { text: t('+{n} para ler', { n: work.unreadReady }), tone: '' }
  if (work.readChapters > 0 && !preparing(work)) return { text: t('Em dia'), tone: 'is-ink' }
  if (preparing(work)) return { text: t('{ready}/{total} prontos', { ready: work.readyChapters, total: work.totalChapters }), tone: 'is-paper' }
  return { text: t('Novo na estante'), tone: 'is-paper' }
}

export function WorksLibrary() {
  const { t } = useT()
  const [works, setWorks] = useState<WorkSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [message, setMessage] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [pending, setPending] = useState<number | null>(null)
  const [imports, setImports] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function load() {
      try {
        const [response, imported] = await Promise.all([fetch('/api/local/works', { signal: controller.signal, cache: 'no-store' }), fetch('/api/local/library', { signal: controller.signal, cache: 'no-store' })])
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || t('Não foi possível carregar sua biblioteca.'))
        if (controller.signal.aborted) return
        setWorks(data.works)
        if (imported.ok) setImports((await imported.json()).items?.length || 0)
      } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : t('Não foi possível carregar a biblioteca.')) }
      finally { if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(() => { if (document.visibilityState === 'visible') void load(); else timer = setTimeout(load, 10000) }, 5000) } }
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [t])
  async function refreshAll() {
    setRefreshing(true)
    try {
      const response = await fetch('/api/local/works/refresh', { method: 'POST' })
      if (!response.ok) throw new Error(t('Não foi possível solicitar a atualização.'))
      setMessage(t('Atualização solicitada. O KOMA buscará novos capítulos e preservará os já preparados.'))
      setWorks((current) => current.map((work) => ({ ...work, syncRequested: true })))
    } catch (error) { setMessage(error instanceof Error ? error.message : t('Não foi possível atualizar.')) }
    finally { setRefreshing(false) }
  }
  async function favorite(work: WorkSummary) {
    setPending(work.id)
    try {
      const response = await fetch(`/api/local/works/${work.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'favorite', favorite: !work.favorite }) })
      if (!response.ok) throw new Error(t('Não foi possível salvar o favorito.'))
      setWorks((current) => current.map((item) => item.id === work.id ? { ...item, favorite: !item.favorite } : item))
    } catch (error) { setMessage(error instanceof Error ? error.message : t('Não foi possível salvar.')) }
    finally { setPending(null) }
  }

  const needle = normalizeTitle(query)
  const counts = { all: works.length, news: works.filter(hasNews).length, favorites: works.filter((work) => work.favorite).length, preparing: works.filter(preparing).length }
  const visible = works.filter((work) => (filter === 'all' || (filter === 'news' ? hasNews(work) : filter === 'favorites' ? work.favorite : preparing(work)))
    && [work.title, work.metadata.originalTitle, ...work.metadata.aliases.map((alias) => alias.title)].some((title) => normalizeTitle(title).includes(needle)))
  const ready = works.reduce((sum, work) => sum + work.readyChapters, 0)
  // A lista já vem ordenada pela última leitura; sem leituras, sugere a primeira obra pronta.
  const current = works.find((work) => work.lastOpenedAt && work.nextChapter) || works.find((work) => work.nextChapter)
  const started = Boolean(current?.readChapters || current?.lastOpenedAt)
  const filters: Array<{ value: Filter; label: string }> = [{ value: 'all', label: t('Todas') }, { value: 'news', label: t('Com novidades') }, { value: 'favorites', label: t('Favoritas') }, { value: 'preparing', label: t('Preparando') }]

  return <div data-library-state={loading ? 'loading' : 'ready'}>
    <header className="koma-page-head">
      <h1>{t('Biblioteca')}</h1>
      <div className="koma-page-tools">
        {works.length ? <label className="koma-search"><Search size={18} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar título ou nome alternativo')} aria-label={t('Buscar na biblioteca')} /></label> : null}
        <Link href="/inicio/obras/nova" className="koma-button"><Plus size={18} aria-hidden="true" />{t('Adicionar obra')}</Link>
      </div>
    </header>

    {current?.nextChapter ? <section className="koma-panel koma-continue" aria-label={started ? t('Continuar lendo') : t('Comece a ler')}>
      <Link href={`/inicio/obras/${current.id}`} className="koma-continue-cover" tabIndex={-1} aria-hidden="true"><WorkCover work={current} sizes="240px" t={t} /></Link>
      <div className="koma-continue-body">
        <p className="koma-eyebrow">{started ? t('Continuar lendo') : t('Comece por aqui')}</p>
        <h2>{current.title}</h2>
        <p>{chapterLabel(current.nextChapter, t)}{current.nextChapter.title ? ` · ${current.nextChapter.title}` : ''} · {current.unreadReady === 1 ? t('{n} capítulo pronto à frente', { n: current.unreadReady }) : t('{n} capítulos prontos à frente', { n: current.unreadReady })}</p>
        <BrushProgress value={current.readChapters} max={current.totalChapters} label={t('{read} de {total} capítulos lidos', { read: current.readChapters, total: current.totalChapters })} />
        <p className="koma-note">{t('{read} de {total} capítulos lidos', { read: current.readChapters, total: current.totalChapters })}</p>
        <div className="koma-continue-actions">
          <Link className="koma-dark-button" href={`/inicio/obras/${current.id}/ler/${current.nextChapter.id}`}><BookOpen size={18} aria-hidden="true" />{started ? t('Continuar') : t('Ler')} · {chapterLabel(current.nextChapter, t)}</Link>
          <Link className="koma-outline-button" href={`/inicio/obras/${current.id}`}>{t('Ver capítulos')}</Link>
        </div>
      </div>
    </section> : null}

    {!works.length && !loading ? <section className="koma-empty">
      <p className="koma-eyebrow">{t('Uma escolha. O KOMA cuida do resto.')}</p>
      <h2>{t('Qual história você quer ler?')}</h2>
      <p>{t('Busque um mangá, manhwa ou manhua, confira a capa e adicione à biblioteca. O KOMA encontra os capítulos, baixa as páginas e prepara a leitura no idioma escolhido.')}</p>
      <Link className="koma-button" href="/inicio/obras/nova"><Search size={18} aria-hidden="true" />{t('Buscar minha primeira obra')}</Link>
    </section> : null}

    {works.length ? <section aria-labelledby="shelf-title">
      <div className="koma-shelf-head">
        <h2 id="shelf-title">{t('Suas obras')} <span>· {works.length === 1 ? t('{n} obra', { n: works.length }) : t('{n} obras', { n: works.length })} · {ready === 1 ? t('{n} capítulo pronto', { n: ready }) : t('{n} capítulos prontos', { n: ready })}</span></h2>
        <div className="koma-filters" role="group" aria-label={t('Filtrar obras')}>
          {filters.map((entry) => <button key={entry.value} type="button" className="koma-pill" aria-pressed={filter === entry.value} onClick={() => setFilter(entry.value)}>{entry.label}<span>{counts[entry.value]}</span></button>)}
          <button id="refresh-library" type="button" className="koma-pill" disabled={refreshing} onClick={() => void refreshAll()}><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />{t('Atualizar')}</button>
        </div>
      </div>
      <p role="status" className="koma-status mb-4">{message}</p>
      {query ? <button className="koma-text-link mb-4" id="clear-work-search" onClick={() => setQuery('')}>{t('Limpar busca')}</button> : null}
      <div className="koma-book-grid">{visible.map((work, index) => {
        const tag = stamp(work, t)
        return <article className="koma-book" key={work.id} style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}>
          <div className="koma-book-cover">
            <Link href={`/inicio/obras/${work.id}`} aria-label={t('Abrir {title}', { title: work.title })}><WorkCover work={work} sizes="(max-width: 760px) 45vw, 240px" t={t} /></Link>
            <button className="koma-favorite" aria-label={work.favorite ? t('Remover favorito: {title}', { title: work.title }) : t('Adicionar favorito: {title}', { title: work.title })} aria-pressed={work.favorite} disabled={pending === work.id} onClick={() => void favorite(work)}><Heart size={18} fill={work.favorite ? 'currentColor' : 'none'} aria-hidden="true" /></button>
            <span className={`koma-stamp ${tag.tone}`}>{work.syncRequested ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : null}{tag.text}</span>
          </div>
          <p className="koma-book-kind">{workKind(work, t)}</p>
          <h3><Link href={`/inicio/obras/${work.id}`}>{work.title}</Link></h3>
          <p className="koma-book-meta">{t('{ready} de {total} prontos', { ready: work.readyChapters, total: work.totalChapters })}{work.readChapters ? ` · ${work.readChapters === 1 ? t('{n} lido', { n: work.readChapters }) : t('{n} lidos', { n: work.readChapters })}` : ''}</p>
          {work.translationWait ? <p className="koma-book-meta">{t('Tradução aguardando liberação')}</p> : null}
        </article>
      })}</div>
      {!visible.length ? <p className="koma-empty mt-2">{t('Nenhuma obra corresponde a este filtro.')}</p> : null}
    </section> : null}
    {loading && !works.length ? <div className="koma-book-grid" aria-busy="true" aria-label={t('Carregando biblioteca')}>{[1, 2, 3, 4, 5].map((id) => <div key={id} className="koma-cover-skeleton" />)}</div> : null}

    <footer className="koma-library-footer">
      <Link className="koma-text-link" href="/inicio/secoes/nova">{t('Importar arquivos do computador')}</Link>
      {imports ? <Link className="koma-text-link" href="/inicio/importados">{imports === 1 ? t('Ver {n} importação avulsa', { n: imports }) : t('Ver {n} importações avulsas', { n: imports })}</Link> : <Link className="koma-text-link" href="/inicio/fontes">{t('Fontes de obras')}</Link>}
    </footer>
  </div>
}
