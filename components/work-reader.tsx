'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Flag, Loader2, PencilLine } from 'lucide-react'
import type { WorkChapter, WorkSummary } from '@/lib/works'
import { ReaderScrollControls, useReaderScroll } from '@/components/reader-scroll'
import { useT } from '@/components/i18n'
import { ReaderSkeleton } from '@/components/koma-skeletons'
import { targetInfo } from '@/lib/languages'

interface ReadingData {
  work: WorkSummary; chapter: WorkChapter; nextChapterId: number | null; previousChapterId: number | null
  pages: Array<{ id: number; note?: string | null; width: number; height: number; originalUrl: string; translatedUrl?: string | null; items: Array<{ id: number; box: number[]; text: string; background?: string; foreground?: string }> }>
}

// Barra vermelha de leitura: só transform, atualizada no máximo uma vez por quadro.
function useScrollProgress(enabled: boolean) {
  const bar = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!enabled) return
    let frame = 0
    const update = () => {
      frame = 0
      const max = document.documentElement.scrollHeight - window.innerHeight
      const element = bar.current
      if (element) element.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule) }
  }, [enabled])
  return bar
}

export function WorkReader({ workId, chapterId }: { workId: number; chapterId: number }) {
  const { t } = useT()
  const [data, setData] = useState<ReadingData | null>(null)
  const [message, setMessage] = useState('')
  const [original, setOriginal] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [redo, setRedo] = useState<'idle' | 'ask' | 'sending'>('idle')
  // Editor de balões: clicar num balão, corrigir o texto e desenhar só aquela página.
  const [editing, setEditing] = useState(false)
  const [balloon, setBalloon] = useState<{ pageId: number; id: number; text: string; draft: string } | null>(null)
  const [saving, setSaving] = useState(false)
  // "Reportar erro": clicar na página com o erro e dizer o tipo; a página entra no gate de qualidade.
  const [reporting, setReporting] = useState(false)
  const [report, setReport] = useState<{ pageId: number; index: number; kind: string; note: string } | null>(null)
  const router = useRouter()
  const scroll = useReaderScroll(Boolean(data))
  const progress = useScrollProgress(Boolean(data))
  useEffect(() => {
    setData(null); setCompleted(false); setMessage(''); setOriginal(false); setBalloon(null); setReport(null)
    const controller = new AbortController()
    void fetch(`/api/local/works/${workId}/chapters/${chapterId}`, { signal: controller.signal, cache: 'no-store' }).then(async (response) => {
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || t('Não foi possível carregar o capítulo.'))
      if (!controller.signal.aborted) setData(result)
    }).catch((error) => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : t('Não foi possível abrir a leitura.')) })
    return () => controller.abort()
  }, [workId, chapterId, t])
  // "Refazer este capítulo": leitura e tradução do zero; volta para a obra, onde o andamento aparece.
  async function redoChapter() {
    setRedo('sending')
    try {
      const response = await fetch(`/api/local/works/${workId}/chapters/${chapterId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'redo' }) })
      if (!response.ok) throw new Error()
      router.push(`/inicio/obras/${workId}`)
    } catch { setRedo('idle'); setMessage(t('Não foi possível refazer o capítulo.')) }
  }
  async function saveBalloon() {
    if (!balloon || saving) return
    setSaving(true); setMessage('')
    try {
      const response = await fetch(`/api/local/works/${workId}/chapters/${chapterId}/balloons`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageId: balloon.pageId, balloonId: balloon.id, text: balloon.draft }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || t('Não foi possível salvar o balão.'))
      const urls = new Map<number, string | null>((result.pages as Array<{ id: number; translatedUrl: string | null }>).map((page) => [page.id, page.translatedUrl]))
      setData((current) => current && { ...current, pages: current.pages.map((page) => ({ ...page, translatedUrl: urls.has(page.id) ? urls.get(page.id) : page.translatedUrl, items: page.items.map((item) => page.id === balloon.pageId && item.id === balloon.id ? { ...item, text: balloon.draft.trim() } : item) })) })
      setBalloon(null)
      setMessage(result.term ? t('Balão corrigido. Nos próximos capítulos, "{before}" vira "{after}".', { before: result.term.before, after: result.term.after }) : t('Balão corrigido e página desenhada de novo.'))
    } catch (error) { setMessage(error instanceof Error ? error.message : t('Não foi possível salvar o balão.')) }
    finally { setSaving(false) }
  }
  async function sendReport(github = false) {
    if (!report || saving) return
    setSaving(true); setMessage('')
    try {
      const response = await fetch(`/api/local/works/${workId}/chapters/${chapterId}/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageId: report.pageId, kind: report.kind, note: report.note, github }) })
      if (!response.ok) throw new Error()
      const result = await response.json()
      // Abre no navegador a issue preenchida (só texto); a pessoa revisa e envia com a conta dela.
      if (github && result.issueUrl) window.open(result.issueUrl, '_blank', 'noopener')
      setReport(null); setMessage(github ? t('Erro reportado na página {n}. A issue foi aberta no navegador: revise e envie pelo GitHub.', { n: report.index + 1 }) : t('Erro reportado na página {n}. Ela passa a ser conferida em toda versão nova.', { n: report.index + 1 }))
    } catch { setMessage(t('Não foi possível reportar o erro.')) }
    finally { setSaving(false) }
  }
  async function done() {
    try {
      const response = await fetch(`/api/local/works/${workId}/chapters/${chapterId}`, { method: 'POST' })
      if (!response.ok) throw new Error()
      setCompleted(true)
    } catch { setMessage(t('Não foi possível salvar a leitura. Tente novamente.')) }
  }
  const title = data ? `${data.chapter.number ? t('Capítulo {n}', { n: data.chapter.number }) : t('Especial')}${data.chapter.title ? ` · ${data.chapter.title}` : ''}` : t('Abrindo leitura…')
  return <div data-work-reader={data ? 'ready' : 'loading'}>
    <header className="koma-reader-bar">
      <Link className="koma-text-link" href={`/inicio/obras/${workId}`}>← {data?.work.title || t('Capítulos da obra')}</Link>
      <h1>{title}</h1>
    </header>
    <div className="koma-reader-progress" aria-hidden="true"><span ref={progress} /></div>
    <div className="koma-reader-body">
      {message ? <p role="status" className="koma-reader-note">{message}</p> : null}
      {!data && !message ? <ReaderSkeleton /> : null}
      {data ? <>
        {data.pages.some((page) => page.note) ? <details className="koma-reader-note"><summary>{t('{n} página(s) com avisos. Trechos sem tradução permanecem no original.', { n: data.pages.filter((page) => page.note).length })}</summary><ul className="mt-2 space-y-2">{data.pages.map((page,index) => page.note ? <li key={page.id}>{t('Página {n}: {note}', { n: index + 1, note: page.note })}</li> : null)}</ul></details> : null}
        <div className="koma-reader-pages">{data.pages.map((page, index) => <div key={page.id} className={`relative${reporting ? ' koma-report-target' : ''}${report?.pageId === page.id ? ' is-on' : ''}`} style={{ aspectRatio: `${page.width}/${page.height}` }} onClick={reporting ? () => setReport({ pageId: page.id, index, kind: report?.kind || 'english', note: '' }) : undefined}>
          {/* Dimensões originais mantêm os balões alinhados e evitam saltos na rolagem. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={!original && page.translatedUrl ? page.translatedUrl : page.originalUrl} alt={t('Página {n}', { n: index + 1 })} width={page.width} height={page.height} loading={index < 2 ? 'eager' : 'lazy'} className="block h-full w-full" />
          {/* Página ainda sendo refeita: mostra o original, sem sobreposição provisória. */}
          {!original && !page.translatedUrl && page.items.length ? <span className="absolute right-2 top-2 rounded bg-black/70 px-2 py-1 text-xs text-white">{t('Tradução desta página em preparação')}</span> : null}
          {editing && !original ? page.items.filter((item) => item.box?.length === 4 && item.box[2] > item.box[0]).map((item) => <button key={item.id} type="button" className={`koma-balloon-spot${balloon?.pageId === page.id && balloon.id === item.id ? ' is-on' : ''}`} style={{ left: `${item.box[0] / page.width * 100}%`, top: `${item.box[1] / page.height * 100}%`, width: `${(item.box[2] - item.box[0]) / page.width * 100}%`, height: `${(item.box[3] - item.box[1]) / page.height * 100}%` }} aria-label={t('Editar balão: {text}', { text: item.text || t('sem tradução') })} onClick={() => setBalloon({ pageId: page.id, id: item.id, text: item.text, draft: item.text })} />) : null}
        </div>)}</div>
        <ReaderScrollControls scroll={scroll} extra={<>
          <button type="button" className="koma-icon-button" aria-pressed={reporting} onClick={(event) => { setReporting(!reporting); setReport(null); setEditing(false); setBalloon(null); event.currentTarget.blur() }} aria-label={reporting ? t('Sair de reportar erro') : t('Reportar erro')} title={reporting ? t('Sair de reportar erro') : t('Reportar erro: clique na página com o problema')}><Flag size={20} aria-hidden="true" /></button>
          <button type="button" className="koma-icon-button" aria-pressed={editing} onClick={(event) => { setEditing(!editing); setReporting(false); setReport(null); setBalloon(null); setOriginal(false); event.currentTarget.blur() }} aria-label={editing ? t('Sair do editor de balões') : t('Editar balões')} title={editing ? t('Sair do editor de balões') : t('Editar balões')}><PencilLine size={20} aria-hidden="true" /></button>
          <button type="button" className="koma-original-toggle" aria-pressed={original} onClick={(event) => { setOriginal(!original); event.currentTarget.blur() }} title={original ? t('Voltar para a tradução') : t('Ver a página original')}>{original ? t('ORIGINAL') : targetInfo(data.work.targetLanguage).short}</button>
          <nav className="koma-reader-chapters" aria-label={t('Capítulos')}>
            {data.previousChapterId ? <Link className="koma-icon-button" href={`/inicio/obras/${workId}/ler/${data.previousChapterId}`} aria-label={t('Capítulo anterior')} title={t('Capítulo anterior')}><ChevronUp size={20} aria-hidden="true" /></Link> : <span className="koma-icon-button is-off" aria-hidden="true"><ChevronUp size={20} /></span>}
            {data.nextChapterId ? <Link className="koma-icon-button" href={`/inicio/obras/${workId}/ler/${data.nextChapterId}`} onClick={() => void done()} aria-label={t('Próximo capítulo')} title={t('Próximo capítulo')}><ChevronDown size={20} aria-hidden="true" /></Link> : <span className="koma-icon-button is-off" aria-hidden="true"><ChevronDown size={20} /></span>}
          </nav>
        </>} />
        {report ? <form className="koma-balloon-editor" aria-label={t('Reportar erro')} onSubmit={(event) => { event.preventDefault(); void sendReport() }}>
          <p className="koma-eyebrow">{t('Erro na página {n}', { n: report.index + 1 })}</p>
          <div className="flex flex-col gap-1" role="radiogroup">{[['english', t('Ficou texto em inglês')], ['outside', t('Frase fora do balão')], ['too-big', t('Letra grande demais')], ['name', t('Nome ou termo errado')], ['other', t('Outro')]].map(([value, label]) => <label key={value} className="koma-switch"><input type="radio" name="report-kind" value={value} checked={report.kind === value} onChange={() => setReport({ ...report, kind: value })} />{label}</label>)}</div>
          <textarea className="koma-input" rows={2} maxLength={500} value={report.note} placeholder={t('O que está errado? (opcional)')} aria-label={t('Detalhe do erro')} onChange={(event) => setReport({ ...report, note: event.target.value })} onKeyDown={(event) => { if (event.key === 'Escape') setReport(null) }} />
          <p className="koma-note">{t('No GitHub vão só o tipo de erro, o texto lido e a tradução desta página, sem imagem, sem o nome da obra e sem links. Você revisa antes de enviar.')}</p>
          <div className="koma-actions"><button className="koma-button" disabled={saving}>{saving ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : null}{t('Reportar')}</button><button type="button" className="koma-outline-button" disabled={saving} onClick={() => void sendReport(true)}>{t('Reportar e enviar para o GitHub')}</button><button type="button" className="koma-outline-button" disabled={saving} onClick={() => setReport(null)}>{t('Cancelar')}</button></div>
        </form> : null}
        {balloon ? <form className="koma-balloon-editor" aria-label={t('Editar balão')} onSubmit={(event) => { event.preventDefault(); void saveBalloon() }}>
          <label htmlFor="balloon-text" className="koma-eyebrow">{t('Texto do balão')}</label>
          <textarea id="balloon-text" className="koma-input" rows={3} maxLength={600} autoFocus value={balloon.draft} onChange={(event) => setBalloon({ ...balloon, draft: event.target.value })} onKeyDown={(event) => { if (event.key === 'Escape') setBalloon(null); if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void saveBalloon() } }} />
          <p className="koma-note">{t('A página é desenhada de novo com o seu texto, e a correção entra no glossário da obra para os próximos capítulos.')}</p>
          <div className="koma-actions"><button className="koma-button" disabled={saving || balloon.draft.trim() === balloon.text.trim()}>{saving ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : null}{t('Salvar balão')}</button><button type="button" className="koma-outline-button" disabled={saving} onClick={() => setBalloon(null)}>{t('Cancelar')}</button></div>
        </form> : null}
        <footer className="koma-reader-footer"><button className="koma-outline-button" disabled={completed} onClick={() => void done()}>{completed ? t('Leitura concluída') : t('Marcar como lido')}</button>
          {redo === 'ask' ? <span className="koma-actions" role="group" aria-label={t('Refazer este capítulo')}><span className="koma-note">{t('Ler e traduzir de novo, do zero?')}</span><button className="koma-outline-button" onClick={() => void redoChapter()}>{t('Refazer')}</button><button className="koma-outline-button" onClick={() => setRedo('idle')}>{t('Cancelar')}</button></span>
            : <button className="koma-outline-button" disabled={redo === 'sending'} onClick={() => setRedo('ask')}>{t('Refazer este capítulo')}</button>}{data.nextChapterId ? <Link className="koma-button" href={`/inicio/obras/${workId}/ler/${data.nextChapterId}`} onClick={() => void done()}>{t('Próximo capítulo')}</Link> : <Link className="koma-button" href={`/inicio/obras/${workId}`}>{t('Voltar aos capítulos')}</Link>}</footer>
      </> : null}
    </div>
  </div>
}
