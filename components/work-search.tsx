'use client'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, BookOpen, Loader2, Plus } from 'lucide-react'
import type { CatalogWork, SourceChapter } from '@/lib/works'
import { useT } from '@/components/i18n'

export function WorkSearch() {
  const router = useRouter()
  const { t } = useT()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CatalogWork[]>([])
  const [selected, setSelected] = useState<CatalogWork | null>(null)
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState('')
  const [availableChapters, setAvailableChapters] = useState<number | null>(null)
  // Capítulos escolhidos para baixar; nenhum marcado = todos.
  const [chapterList, setChapterList] = useState<SourceChapter[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // "Já está lendo?": capítulo em que parou; a fila começa nele e volta ao início depois.
  const [startFrom, setStartFrom] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const selectedId = selected?.sourceId
  useEffect(() => {
    setAvailableChapters(null); setChapterList([]); setPicked(new Set()); setStartFrom('')
    if (!selectedId) return
    const controller = new AbortController()
    // Fonte personalizada ("site:obra"): a busca traz só o resumo; os detalhes vêm da página da obra.
    if (selectedId.includes(':')) {
      void fetch(`/api/local/catalog/${selectedId}`, {signal:controller.signal}).then(async response=>{
        if (!response.ok) return
        const data=await response.json()
        if (!controller.signal.aborted) setSelected(current=>current?.sourceId===selectedId ? data.work : current)
      }).catch(()=>{ /* A fonte permanece identificada mesmo sem detalhes adicionais. */ })
    }
    void fetch(`/api/local/catalog/${selectedId}/chapters`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) return
      const data = await response.json()
      if (!controller.signal.aborted) { setAvailableChapters(data.total); setChapterList(data.chapters || []) }
    }).catch(() => { /* A descoberta será tentada novamente pela fila ao adicionar. */ })
    return () => controller.abort()
  }, [selectedId])
  async function search(event: React.FormEvent) {
    event.preventDefault(); request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setSearching(true); setMessage(''); setSelected(null)
    try {
      const response = await fetch(`/api/local/catalog?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || t('Não foi possível pesquisar.'))
      if (!controller.signal.aborted) { setResults(data.results); setSearched(true); setMessage(data.sources?.filter((source: {available:boolean})=>!source.available).map((source: {name:string})=>t('{name} indisponível; exibindo as demais fontes.', { name: source.name })).join(' ') || '') }
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : t('Não foi possível pesquisar.')) }
    finally { if (!controller.signal.aborted) setSearching(false) }
  }
  async function add() {
    if (!selected || adding) return
    setAdding(true); setMessage('')
    try {
      const response = await fetch('/api/local/works', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: selected.sourceId, startFrom: startFrom || undefined, chapters: chapterList.filter((chapter) => picked.has(chapter.key)).map((chapter) => ({ key: chapter.key, number: chapter.number })) }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || t('Não foi possível adicionar a obra.'))
      router.push(`/inicio/obras/${data.id}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : t('Não foi possível adicionar.')); setAdding(false) }
  }
  const sourceName = (work: CatalogWork) => work.sourceName || (work.source === 'mangadex' ? 'MangaDex' : work.source)
  return <div data-work-search>
    <header className="koma-page-head"><div><p className="koma-eyebrow">{t('Mangá · Manhwa · Manhua')}</p><h1>{t('Adicionar obra')}</h1><p>{t('Busque pelo nome que você conhece. Confira a obra antes de adicionar; derivados e continuações aparecem separados.')}</p></div></header>
    <form onSubmit={(event) => void search(event)} className="mb-6 flex flex-wrap gap-3"><label className="koma-search min-w-0 flex-1"><Search size={20} aria-hidden="true" /><input id="catalog-query" required minLength={2} maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Ex.: Eminence in Shadow')} aria-label={t('Título da obra')} /></label><button className="koma-button" disabled={searching || query.trim().length < 2}>{searching ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}{t('Buscar')}</button></form>
    <p role="status" className="koma-status mb-4">{message}</p>
    {selected ? <section className="koma-panel koma-pick" aria-label={t('Conferir obra')}>
      <div className="koma-work-cover">{selected.coverFile ? <Image src={`/api/local/catalog/${selected.sourceId}/cover`} alt={t('Capa de {title}', { title: selected.title })} fill sizes="240px" unoptimized /> : <span className="koma-cover-placeholder" aria-hidden="true">コマ</span>}</div>
      <div className="koma-work-info"><p className="koma-eyebrow">{t('Confirme sua escolha')}</p><h1>{selected.title}</h1><p className="koma-muted">{selected.authors.join(' · ')}{selected.year ? ` · ${selected.year}` : ''}</p>
        <p className="koma-note">{t('Título original: {title}', { title: selected.originalTitle })}</p>
        <div className="koma-tags">{selected.aliases.slice(0, 12).map((alias, i) => <span key={`${alias.language}-${i}`}>{alias.title}</span>)}</div>
        <div><h2 className="font-bold">{selected.descriptionLanguage && !selected.descriptionLanguage.startsWith('pt') ? t('Sinopse da fonte ({language})', { language: selected.descriptionLanguage === 'en' ? t('inglês') : selected.descriptionLanguage }) : t('Sinopse')}</h2><p className="koma-synopsis is-open mt-2 max-h-64 overflow-auto">{selected.description || t('Esta fonte ainda não tem uma sinopse para a obra.')}</p></div>
        <p className="koma-note">{t('Fonte: {source}. Ao adicionar, o KOMA procura os capítulos disponíveis, consolida versões repetidas e prepara a leitura em PT-BR. A tradução usa os provedores autorizados nas preferências e consome sua cota.', { source: sourceName(selected) })}</p>
        <p className="font-semibold">{availableChapters === null ? t('Conferindo os capítulos disponíveis…') : availableChapters === 1 ? t('1 capítulo disponível nesta fonte, sem repetir versões.') : t('{n} capítulos disponíveis nesta fonte, sem repetir versões.', { n: availableChapters })}</p>
        {chapterList.some((chapter) => chapter.number) ? <div className="space-y-1" data-reading-from>
          <label htmlFor="reading-from" className="text-sm font-medium">{t('Já está lendo esta obra?')}</label>
          <select id="reading-from" className="h-10 w-full max-w-sm rounded-[4px] border-2 border-input bg-background px-3 text-sm" value={startFrom} onChange={(event) => setStartFrom(event.target.value)}>
            <option value="">{t('Não, começar do primeiro capítulo')}</option>
            {[...new Set(chapterList.flatMap((chapter) => chapter.number ? [chapter.number] : []))].map((number) => <option key={number} value={number}>{t('Parei no capítulo {n}', { n: number })}</option>)}
          </select>
          {startFrom ? <p className="koma-note">{t('O KOMA prepara primeiro do capítulo {n} até o último e depois volta ao começo. Os capítulos antes do {n} ficam marcados como lidos.', { n: startFrom })}</p> : null}
        </div> : null}
        {chapterList.length > 1 ? <details className="koma-details" data-chapter-choice>
          <summary>{t('Escolher capítulos')} · {picked.size ? t('{n} capítulo(s) escolhido(s).', { n: picked.size }) : t('Nenhum marcado: todos serão baixados.')}</summary>
          <div>
            <div className="koma-actions"><button type="button" className="koma-outline-button" onClick={() => setPicked(new Set(chapterList.map((chapter) => chapter.key)))}>{t('Marcar todos')}</button><button type="button" className="koma-outline-button" onClick={() => setPicked(new Set())}>{t('Desmarcar todos')}</button></div>
            <ul className="koma-chapter-choice">{chapterList.map((chapter) => <li key={chapter.key}><label><input type="checkbox" checked={picked.has(chapter.key)} onChange={(event) => setPicked((current) => { const next = new Set(current); if (event.target.checked) next.add(chapter.key); else next.delete(chapter.key); return next })} />{chapter.number ? t('Cap. {n}', { n: chapter.number }) : t('Especial')}</label></li>)}</ul>
          </div>
        </details> : null}
        <div className="koma-actions"><button id="add-work" className="koma-button" disabled={adding} onClick={() => void add()}>{adding ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}{t('Adicionar à biblioteca')}</button><button className="koma-outline-button" disabled={adding} onClick={() => setSelected(null)}>{t('Voltar aos resultados')}</button></div>
      </div>
    </section> : <div className="koma-result-grid">{results.map((work) => <button key={work.sourceId} data-source-id={work.sourceId} className="koma-result" onClick={() => setSelected(work)}>
      <span className="koma-result-thumb">{work.coverFile ? <Image src={`/api/local/catalog/${work.sourceId}/cover`} alt="" fill sizes="96px" unoptimized /> : <BookOpen className="m-7" size={30} aria-hidden="true" />}</span>
      <span className="flex min-w-0 flex-col gap-1"><span className="koma-book-kind">{sourceName(work)}</span><span className="koma-result-title">{work.title}</span><span className="koma-result-meta line-clamp-2">{work.originalTitle}</span><span className="koma-result-meta">{work.authors.join(' · ')}{work.year ? ` · ${work.year}` : ''}</span><span className="koma-text-link mt-auto">{t('Ver detalhes →')}</span></span>
    </button>)}</div>}
    {searched && !searching && !results.length ? <p className="koma-empty">{t('Nenhuma correspondência nas fontes consultadas. Tente outro título ou uma romanização. A busca consulta os títulos alternativos cadastrados no catálogo.')}</p> : null}
    <p className="koma-note mt-8">{t('A busca consulta o MangaDex e as fontes que você adicionou nas Preferências, cada uma de forma independente. Uma fonte indisponível não impede resultados das outras. O KOMA não confunde um resultado sem capítulos com uma obra já preparada.')}</p>
  </div>
}
