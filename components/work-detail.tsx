'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowLeft, BookOpen, RefreshCw, Pause, Play, Heart } from 'lucide-react'
import { preparationLabels, type WorkChapter, type WorkSummary } from '@/lib/works'
import { BrushProgress, WorkCover, chapterLabel, workKind, type Translate } from '@/components/koma-ui'
import { useT } from '@/components/i18n'
import { targetInfo } from '@/lib/languages'
import { WorkSkeleton } from '@/components/koma-skeletons'

type Source = { kind: string; url: string; message: string; status: string }
const BLOCK = 30
const waitingTags: Record<string, string> = { discovering: 'BUSCA', queued: 'FILA', downloading: 'BAIXANDO', ocr: 'OCR', translating: 'TRADUZINDO', downloaded: 'BAIXADO', blocked: 'AGUARDA', paused: 'PAUSA', rendering: 'DESENHO' }

function host(url: string) { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

function cell(chapter: WorkChapter, work: WorkSummary, t: Translate) {
  const readable = ['ready', 'partial'].includes(chapter.state)
  if (chapter.read) return { tone: 'is-read', tag: t('LIDO'), readable }
  if (readable) {
    const fresh = work.lastOpenedAt && chapter.createdAt > work.lastOpenedAt
    return { tone: `${fresh ? 'is-new' : ''} ${chapter.state === 'partial' ? 'is-partial' : ''}`, tag: fresh ? t('NOVO') : chapter.state === 'partial' ? t('AVISOS') : t('PRONTO'), readable }
  }
  if (chapter.state === 'error') return { tone: 'is-error', tag: t('ERRO'), readable }
  if (chapter.state === 'skipped') return { tone: 'is-skipped', tag: t('NÃO BAIXADO'), readable }
  return { tone: 'is-waiting', tag: t(waitingTags[chapter.state] || 'FILA'), readable }
}

export function WorkDetail({ id }: { id: number }) {
  const { t, locale } = useT()
  const [detail, setDetail] = useState<{ work: WorkSummary; chapters: WorkChapter[]; sources?: Source[] } | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [block, setBlock] = useState<number | null>(null)
  const [synopsisOpen, setSynopsisOpen] = useState(false)
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>
    async function load() {
      try {
        const response = await fetch(`/api/local/works/${id}`, { signal: controller.signal, cache: 'no-store' }); const data = await response.json()
        if (!response.ok) throw new Error(data.message || t('Não foi possível abrir a obra.'))
        if (!controller.signal.aborted) setDetail(data)
      } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : t('Não foi possível abrir.')) }
      finally { if (!controller.signal.aborted) timer = setTimeout(load, 3000) }
    }
    void load(); return () => { controller.abort(); clearTimeout(timer) }
  }, [id, t])
  // Capítulo não escolhido ao adicionar a obra: um clique põe na fila.
  async function download(chapter: WorkChapter) {
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/local/works/${id}/chapters/${chapter.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'download' }) })
      if (!response.ok) throw new Error((await response.json()).message || t('Não foi possível realizar esta ação.'))
      setMessage(t('Capítulo na fila para baixar e preparar.'))
      const snapshot = await fetch(`/api/local/works/${id}`, { cache: 'no-store' }); if (snapshot.ok) setDetail(await snapshot.json())
    } catch (error) { setMessage(error instanceof Error ? error.message : t('Não foi possível realizar a ação.')) }
    finally { setBusy(false) }
  }
  async function action(value: string) {
    if (!detail) return
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/local/works/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: value, ...(value === 'favorite' ? { favorite: !detail.work.favorite } : {}), ...(value==='source'?{url:sourceUrl}:{}) }) })
      if (!response.ok) throw new Error((await response.json()).message || t('Não foi possível realizar esta ação.'))
      if (value==='source') {setSourceUrl('');setMessage(t('Fonte vinculada. Consultando o índice completo e mantendo os capítulos já preparados.'))}
      else if (value === 'refresh') setMessage(t('Buscando novos capítulos. Os capítulos já preparados serão mantidos.'))
      else setMessage(value === 'pause' ? t('Pausa solicitada. As etapas concluídas permanecem salvas.') : value === 'resume' ? t('Fila retomada. O KOMA continuará de onde parou.') : t('Favorito atualizado.'))
      const snapshot = await fetch(`/api/local/works/${id}`, { cache: 'no-store' }); if (snapshot.ok) setDetail(await snapshot.json())
    } catch (error) { setMessage(error instanceof Error ? error.message : t('Não foi possível realizar a ação.')) }
    finally { setBusy(false) }
  }
  const work = detail?.work
  const chapters = detail?.chapters || []
  const next = work?.nextChapter ? chapters.find((chapter) => chapter.id === work.nextChapter?.id) : undefined
  const blocks = Array.from({ length: Math.ceil(chapters.length / BLOCK) }, (_, index) => chapters.slice(index * BLOCK, (index + 1) * BLOCK))
  const nextBlock = next ? Math.floor(chapters.indexOf(next) / BLOCK) : 0
  const shown = Math.min(block ?? nextBlock, Math.max(0, blocks.length - 1))
  const sources = (detail?.sources || []).filter((source, index, list) => source.url && list.findIndex((other) => other.url === source.url) === index)
  const flagged = chapters.filter((chapter) => chapter.message && ['error', 'partial', 'blocked'].includes(chapter.state))
  const unconfirmed = chapters.filter((chapter) => chapter.pageCount === 0).length
  const targetShort = targetInfo(work?.targetLanguage).short
  const rangeLabel = (items: WorkChapter[], index: number) => {
    const first = items[0]?.number, last = items[items.length - 1]?.number
    return first && last ? `${first}–${last}` : `${index * BLOCK + 1}–${index * BLOCK + items.length}`
  }

  return <div data-work-detail={work ? 'ready' : 'loading'}>
    <Link href="/inicio/secoes" className="koma-text-link koma-back"><ArrowLeft size={18} aria-hidden="true" />{t('Biblioteca')}</Link>
    {!work && !message ? <WorkSkeleton /> : null}
    {work ? <>
      <section className="koma-work-hero">
        <div className="koma-work-cover"><WorkCover work={work} sizes="240px" t={t} /></div>
        <div className="koma-work-info">
          <p className="koma-eyebrow">{[workKind(work, t), ...work.metadata.authors, work.metadata.year].filter(Boolean).join(' · ')}</p>
          <h1>{work.title}</h1>
          {work.metadata.description ? <>
            <p className={`koma-synopsis ${synopsisOpen ? 'is-open' : ''}`}>{work.metadata.description}</p>
            {work.metadata.description.length > 320 ? <button type="button" className="koma-text-link w-fit" onClick={() => setSynopsisOpen(!synopsisOpen)}>{synopsisOpen ? t('Mostrar menos') : t('Ler sinopse completa')}</button> : null}
          </> : <p className="koma-note">{t('Sem sinopse nesta fonte.')}</p>}
          <div className="koma-actions">
            {next ? <Link className="koma-button" href={`/inicio/obras/${id}/ler/${next.id}`}><BookOpen size={18} aria-hidden="true" />{work.readChapters ? t('Continuar') : t('Começar')} · {chapterLabel(next, t)}</Link> : null}
            <button id="refresh-work" className="koma-outline-button" disabled={busy || work.syncRequested} onClick={() => void action('refresh')}><RefreshCw size={17} className={work.syncRequested ? 'animate-spin' : ''} aria-hidden="true" />{work.syncRequested ? t('Buscando capítulos') : t('Buscar novos capítulos')}</button>
            <button className="koma-outline-button" disabled={busy} onClick={() => void action(work.paused ? 'resume' : 'pause')}>{work.paused ? <Play size={17} aria-hidden="true" /> : <Pause size={17} aria-hidden="true" />}{work.paused ? t('Retomar preparação') : t('Pausar preparação')}</button>
            {!work.paused && (work.stage === 'error' || work.stage === 'blocked' || work.translationWait?.manual) ? <button className="koma-outline-button" disabled={busy} onClick={() => void action('resume')}><Play size={17} aria-hidden="true" />{work.translationWait?.manual ? t('Retomar tradução') : t('Tentar novamente')}</button> : null}
            <button id="favorite-work" aria-pressed={work.favorite} aria-label={work.favorite ? t('Remover dos favoritos') : t('Favoritar obra')} className="koma-icon-button" disabled={busy} onClick={() => void action('favorite')}><Heart size={20} fill={work.favorite ? 'currentColor' : 'none'} aria-hidden="true" /></button>
          </div>
          <p role="status" className="koma-status">{message}</p>
        </div>
        <aside className="koma-box koma-prep" aria-label={t('Preparação')}>
          <h2>{t('PREPARAÇÃO')}</h2>
          <div className="koma-stats">
            <div className="koma-stat"><strong>{work.readyChapters}</strong><span>{t('prontos')}</span></div>
            <div className="koma-stat"><strong>{work.totalChapters - work.readyChapters}</strong><span>{t('na fila')}</span></div>
            <div className="koma-stat"><strong>{work.readChapters}</strong><span>{t('lidos')}</span></div>
            <div className="koma-stat"><strong>{work.preparedPages}</strong><span>{t('páginas em {lang}', { lang: targetShort })}</span></div>
          </div>
          <BrushProgress value={work.readyChapters} max={work.totalChapters} label={t('Progresso dos capítulos prontos')} red />
          <p className="koma-note" data-work-stage={work.stage}>{work.syncRequested ? t('Buscando a lista de capítulos…') : work.stage === 'queued' ? t('Na fila, alternando entre suas obras') : t(preparationLabels[work.stage] || 'Na biblioteca')} · {t('{n} de {total} com originais baixados', { n: work.downloadedChapters, total: work.totalChapters })}</p>
          {sources.length ? <><h2>{t('FONTES')}</h2><ul className="koma-chips">{sources.map((source) => <li key={source.url} className={source.kind === 'original' ? 'is-main' : undefined} title={source.message}>{host(source.url)}{source.kind === 'original' ? ` · ${t('original')}` : source.kind === 'licensed' ? ` · ${t('oficial')}` : ''}</li>)}</ul></> : null}
        </aside>
      </section>

      {work.translationWait ? <p className="koma-alert mb-4" role="status">{work.translationWait.message} {work.translationWait.manual ? t('Autorize a tradução no KPassword e clique em Retomar tradução.') : t('Nova tentativa de tradução após {time}.', { time: new Date(work.translationWait.retryAt).toLocaleTimeString(locale) })} {t('Os downloads continuam durante a espera.')}</p> : null}
      {work.message ? <p className="koma-alert mb-4">{work.message} {work.stage === 'blocked' ? <Link className="underline" href="/inicio/preferencias">{t('Abrir preferências')}</Link> : null}</p> : null}

      <section aria-labelledby="chapters-title" className="mb-8">
        <div className="koma-chapters-head">
          <div><h2 id="chapters-title" className="koma-section-title">{t('Capítulos')}</h2><p className="koma-note">{t('{n} catalogados', { n: work.totalChapters })} · {work.lastSyncedAt ? t('atualizado em {date}', { date: new Date(work.lastSyncedAt).toLocaleString(locale) }) : t('buscando capítulos')}</p></div>
          {blocks.length > 1 ? <div className="koma-ranges" role="group" aria-label={t('Blocos de capítulos')}>{blocks.map((items, index) => <button key={index} type="button" aria-pressed={index === shown} onClick={() => setBlock(index)}>{rangeLabel(items, index)}</button>)}</div> : null}
        </div>
        {!chapters.length ? <div className="koma-empty"><p>{work.syncRequested ? t('Procurando todos os capítulos disponíveis…') : t('A fonte não disponibiliza capítulos para download desta obra neste momento.')}</p></div>
          : <ol className="koma-panels">{(blocks[shown] || []).map((chapter) => {
            const state = cell(chapter, work, t)
            const name = `${chapter.volume ? `${t('Vol. {n}', { n: chapter.volume })}, ` : ''}${chapter.number ? t('capítulo {n}', { n: chapter.number }) : t('especial')}${chapter.title ? `: ${chapter.title}` : ''}`
            const detailText = `${t(preparationLabels[chapter.state] || 'Na fila')} · ${t('{ready}/{total} páginas', { ready: chapter.readyPages, total: chapter.pageCount })}${chapter.read ? ` · ${t('lido')}` : ''}`
            const body = <><strong>{chapter.number || t('ESP')}</strong><small>{state.tag}</small></>
            const className = `koma-panel-cell ${state.tone} ${chapter.id === next?.id ? 'is-next' : ''}`
            return <li key={chapter.id} data-chapter-state={chapter.state}>{chapter.state === 'skipped'
              ? <button type="button" className={className} disabled={busy} onClick={() => void download(chapter)} aria-label={t('Baixar {name}', { name })} title={t('Capítulo não escolhido ao adicionar. Clique para baixar e preparar.')}>{body}</button>
              : state.readable
              ? <Link className={className} href={`/inicio/obras/${id}/ler/${chapter.id}`} aria-label={t('Ler {name}. {detail}', { name, detail: detailText })} title={`${name}\n${detailText}`}>{body}</Link>
              : <span className={className} title={`${name}\n${detailText}`} aria-label={`${name}. ${detailText}`}>{body}</span>}</li>
          })}</ol>}
        <div className="koma-legend" aria-hidden="true"><span><i className="is-read" />{t('Lido')}</span><span><i />{t('Pronto para ler')}</span><span><i className="is-new" />{t('Novo desde a última leitura')}</span><span><i className="is-waiting" />{t('Em preparação')}</span></div>
        {unconfirmed ? <p className="koma-note mt-3">{t('A contagem de páginas de {n} capítulo(s) ainda será confirmada durante a coleta.', { n: unconfirmed })}</p> : null}
      </section>

      <div className="flex flex-col gap-4">
        {flagged.length ? <details className="koma-details"><summary>{flagged.length === 1 ? t('{n} capítulo com aviso', { n: flagged.length }) : t('{n} capítulos com avisos', { n: flagged.length })}</summary><div>{flagged.map((chapter) => <p key={chapter.id}><strong>{chapterLabel(chapter, t)}</strong> · {chapter.message}</p>)}</div></details> : null}
        <details className="koma-details"><summary>{t('Nomes alternativos')}</summary><div><p className="break-words">{work.metadata.aliases.map((alias) => alias.title).join(' · ') || t('Nenhum nome alternativo nesta fonte.')}</p></div></details>
        <details className="koma-details"><summary>{t('Publicação original e outras fontes')}</summary><div>
          {sources.map((source) => <div key={source.url}><p className="font-semibold">{source.kind === 'original' ? t('Publicação original') : source.kind === 'licensed' ? t('Edição licenciada') : t('Fonte alternativa')}</p><p className="koma-note break-all">{source.url}</p><p>{source.message}</p></div>)}
          <p className="koma-note">{t('A consulta começa pela publicação original. As versões em {lang} já preparadas são preservadas. Falhas de acesso ou OCR podem acionar outra versão do mesmo capítulo.', { lang: targetShort })}</p>
          <Link className="koma-text-link" href="/inicio/fontes">{t('Ver fontes do Japão, Coreia e China e seus recursos')}</Link>
          <form className="flex flex-col gap-2" onSubmit={(event)=>{event.preventDefault();void action('source')}}>
            <label htmlFor="work-source-url" className="font-semibold">{t('Vincular outra fonte desta obra')}</label>
            <div className="flex flex-wrap gap-2"><input id="work-source-url" type="url" required maxLength={500} value={sourceUrl} onChange={(event)=>setSourceUrl(event.target.value)} placeholder={t('Link da mesma obra na fonte')} className="koma-input flex-1"/><button className="koma-outline-button" disabled={busy}>{t('Vincular fonte')}</button></div>
            <p className="koma-note">{t('Use uma fonte da lista acima. Os capítulos serão consultados automaticamente conforme os recursos do conector.')}</p>
          </form>
        </div></details>
      </div>
    </> : <p role="status" className="koma-note">{message || t('Abrindo sua obra…')}</p>}
  </div>
}
