'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useT } from './i18n'

interface SourcesState { custom: Array<{ id: string; name: string; origin: string }>; local: Array<{ id: string; name: string }>; folder: string }

// Fontes personalizadas: sites que o próprio usuário adiciona. O KOMA não traz
// nenhum site não oficial.
export function SourceSettings() {
  const { t } = useT()
  const [sources, setSources] = useState<SourcesState | null>(null)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    void fetch('/api/local/sources', { cache: 'no-store' }).then((response) => response.json()).then(setSources).catch(() => setMessage(t('Não foi possível consultar as fontes.')))
  }, [t])
  async function send(method: 'POST' | 'DELETE', body: object) {
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/local/sources', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || t('Não foi possível salvar.'))
      setSources(data)
      return data
    } catch (error) { setMessage(error instanceof Error ? error.message : t('Não foi possível salvar.')); return null }
    finally { setBusy(false) }
  }
  async function add(event: React.FormEvent) {
    event.preventDefault()
    const data = await send('POST', { url, name })
    if (data?.added) { setUrl(''); setName(''); setMessage(t('{name} adicionado: {n} capítulos encontrados na obra de teste. O site entra na busca e na próxima atualização de cada obra.', { name: data.added.name, n: data.added.chapters })) }
  }
  return <>
    <p className="text-sm text-muted-foreground">{t('O KOMA usa as publicações originais e as fontes abertas: Naver Webtoon, Shonen Jump+, WEBTOON e MangaDex. Nenhum site não oficial vem incluído.')}</p>
    <p className="text-sm text-muted-foreground">{t('Você pode adicionar outros sites por conta própria. Cole o link de uma obra num site feito com o tema Madara (WordPress), o mais comum entre sites de leitura. O KOMA confere se o site responde nesse formato antes de adicionar.')}</p>
    {sources?.custom.length ? <ul className="koma-pref-list" data-custom-sources>{sources.custom.map((source) => <li key={source.id} className="flex items-center justify-between gap-3"><span><strong>{source.name}</strong><br /><span className="koma-note">{source.origin}</span></span><button type="button" className="koma-outline-button" disabled={busy} onClick={() => { if (window.confirm(t('Remover {name} das suas fontes? Capítulos já baixados continuam na biblioteca.', { name: source.name }))) void send('DELETE', { id: source.id }) }}><Trash2 size={16} aria-hidden="true" />{t('Remover')}</button></li>)}</ul> : null}
    <form onSubmit={(event) => void add(event)} className="flex flex-wrap gap-2">
      <input id="custom-source-url" type="url" required maxLength={500} value={url} onChange={(event) => setUrl(event.target.value)} placeholder={t('Link de uma obra no site')} aria-label={t('Link de uma obra no site')} className="koma-input min-w-0 flex-[2]" />
      <input id="custom-source-name" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} placeholder={t('Nome (opcional)')} aria-label={t('Nome da fonte')} className="koma-input min-w-0 flex-1" />
      <button className="koma-button" disabled={busy || !url.trim()}>{busy ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}{t('Adicionar fonte')}</button>
    </form>
    {sources?.local.length ? <p className="koma-note">{t('Conectores locais carregados: {names}.', { names: sources.local.map((item) => item.name).join(', ') })}</p> : null}
    <p className="koma-note">{t('Ao usar sites não oficiais, você assume a responsabilidade pelo uso e deve respeitar os direitos autorais e os termos de cada site. Sempre que puder, apoie os autores nas plataformas oficiais.')}</p>
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
  </>
}
