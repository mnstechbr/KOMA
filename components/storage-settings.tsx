'use client'

import { useCallback, useEffect, useState } from 'react'
import { useT } from './i18n'

type Provider = 'local' | 'gdrive' | 'onedrive' | 'rclone'
interface Settings { provider: Provider; remote: string; folder: string; mode: 'mirror' | 'cloud'; cacheGb: number }
interface Snapshot {
  settings: Settings
  rclone: { installed: boolean; version: string }
  connected: { gdrive: boolean; onedrive: boolean }
  connecting?: Record<'gdrive' | 'onedrive', { running: boolean; error: string }>
  userRemotes: string[]
  active: boolean
  status: { uploaded: number; pending: number; evicted: number; ready: number; uploading: number | null; lastError: string; lastSyncAt: string | null }
  space: { total: number | null; used: number | null; free: number | null } | null
}

const gb = (bytes: number | null | undefined, locale: string) => bytes == null ? '—' : `${(bytes / 1024 ** 3).toLocaleString(locale, { maximumFractionDigits: 1 })} GB`
const ACCOUNTS: Array<{ id: 'gdrive' | 'onedrive'; name: string }> = [{ id: 'gdrive', name: 'Google Drive' }, { id: 'onedrive', name: 'OneDrive' }]

// Onde ficam os capítulos prontos: no computador ou na nuvem do próprio usuário.
export function StorageSettings() {
  const { t, locale } = useT()
  const [data, setData] = useState<Snapshot | null>(null)
  const [draft, setDraft] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/local/storage', { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.message)
      setData(body); setDraft((current) => current ?? body.settings)
    } catch { setMessage(t('Não foi possível consultar o armazenamento.')) }
  }, [t])
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 15000); return () => clearInterval(timer) }, [refresh])

  async function call(method: 'PUT' | 'POST', body: object, done: string) {
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/local/storage', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message)
      if (method === 'PUT') { setData(result); setDraft(result.settings) }
      setMessage(done)
      if (method === 'POST') void refresh()
    } catch (error) { setMessage(error instanceof Error && error.message ? error.message : t('Não foi possível concluir.')) }
    finally { setBusy(false) }
  }

  if (!data || !draft) return <p className="koma-note">{t('Consultando…')}</p>
  const status = data.status
  const changed = JSON.stringify(draft) !== JSON.stringify(data.settings)
  const canUse = (provider: Provider) => provider === 'local' || provider === 'rclone' ? true : data.connected[provider]

  return <>
    <p className="text-sm text-muted-foreground">{t('Ao conectar, o KOMA cria a pasta')} <strong>{draft.folder || 'KOMA'}</strong> {t('na raiz da sua nuvem. Cada capítulo pronto vai para lá como um arquivo .cbz, com as páginas traduzidas na frente e os originais guardados junto. Esse arquivo abre em qualquer leitor de quadrinhos. O banco da biblioteca e o progresso de leitura continuam no computador.')}</p>
    {!data.rclone.installed ? <p className="text-sm font-semibold">{t('Para usar a nuvem, instale o rclone, por exemplo com')} <code>sudo dnf install rclone</code>{t(', e reabra esta tela.')}</p> : null}

    <h3 className="koma-pref-sub">{t('Contas')}</h3>
    <ul className="flex flex-col gap-2">
      {ACCOUNTS.map((account) => <li key={account.id} className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-medium">{account.name}</p><p className="text-sm text-muted-foreground"><span aria-hidden="true">{data.connected[account.id] ? '● ' : '○ '}</span>{data.connected[account.id] ? t('Conectado') : data.connecting?.[account.id]?.running ? t('Aguardando o login no navegador…') : t('Não conectado')}</p>{!data.connected[account.id] && data.connecting?.[account.id]?.error ? <p className="text-sm font-semibold">{t(data.connecting[account.id].error)}</p> : null}</div>
        {data.connected[account.id]
          ? <button type="button" className="koma-outline-button" disabled={busy || data.settings.provider === account.id} onClick={() => void call('POST', { action: 'disconnect', provider: account.id }, t('{name} desconectado.', { name: account.name }))}>{t('Desconectar')}</button>
          : <button type="button" className="koma-button" disabled={busy || !data.rclone.installed} onClick={() => void call('POST', { action: 'connect', provider: account.id }, t('Abrimos o login do {name} no navegador. Depois de entrar, aguarde alguns segundos.', { name: account.name }))}>{t('Conectar')}</button>}
      </li>)}
    </ul>

    <h3 className="koma-pref-sub">{t('Onde guardar os capítulos')}</h3>
    <div className="flex flex-col gap-2">
      {(['local', 'gdrive', 'onedrive', 'rclone'] as Provider[]).map((provider) => <label key={provider} className="koma-switch">
        <input type="radio" name="storage-provider" checked={draft.provider === provider} disabled={busy || !canUse(provider)} onChange={() => setDraft({ ...draft, provider })} />
        <span>{provider === 'local' ? t('Só neste computador') : provider === 'gdrive' ? 'Google Drive' : provider === 'onedrive' ? 'OneDrive' : t('Outro serviço do rclone (Dropbox, MEGA, Nextcloud…)')}
          {!canUse(provider) ? <span className="koma-note"> · {t('conecte a conta primeiro')}</span> : null}</span>
      </label>)}
    </div>
    {draft.provider === 'rclone' ? <label className="flex flex-col gap-1 text-sm">{t('Remoto do seu rclone')}
      <select className="h-10 rounded-[4px] border-2 border-input bg-background px-3 text-sm" value={draft.remote} disabled={busy} onChange={(event) => setDraft({ ...draft, remote: event.target.value })}>
        <option value="">{t('Escolha…')}</option>{data.userRemotes.map((remote) => <option key={remote} value={remote}>{remote}</option>)}
      </select>
      <span className="koma-note">{t('Configure novos serviços com')} <code>rclone config</code> {t('no terminal.')}</span></label> : null}
    {draft.provider !== 'local' ? <>
      <label className="flex flex-col gap-1 text-sm">{t('Nome da pasta na nuvem')}
        <input className="h-10 rounded-[4px] border-2 border-input bg-background px-3 text-sm" value={draft.folder} maxLength={80} disabled={busy} onChange={(event) => setDraft({ ...draft, folder: event.target.value })} /></label>
      <label className="koma-switch"><input type="radio" name="storage-mode" checked={draft.mode === 'mirror'} disabled={busy} onChange={() => setDraft({ ...draft, mode: 'mirror' })} /><span>{t('No computador e na nuvem')}<br /><span className="koma-note">{t('A nuvem funciona como cópia de segurança. Ocupa o mesmo espaço de hoje no computador.')}</span></span></label>
      <label className="koma-switch"><input type="radio" name="storage-mode" checked={draft.mode === 'cloud'} disabled={busy} onChange={() => setDraft({ ...draft, mode: 'cloud' })} /><span>{t('Só na nuvem, com espaço limitado no computador')}<br /><span className="koma-note">{t('Os capítulos já conferidos na nuvem saem do computador quando passam do limite. Os 3 próximos de cada obra ficam sempre aqui. Ao abrir um capítulo que está só na nuvem, ele é baixado em alguns segundos.')}</span></span></label>
      {draft.mode === 'cloud' ? <label className="flex flex-col gap-1 text-sm">{t('Espaço máximo no computador (GB)')}
        <input type="number" min={0.5} max={500} step={0.5} className="h-10 w-32 rounded-[4px] border-2 border-input bg-background px-3 text-sm" value={draft.cacheGb} disabled={busy} onChange={(event) => setDraft({ ...draft, cacheGb: Number(event.target.value) })} /></label> : null}
    </> : null}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="koma-button" disabled={busy || !changed} onClick={() => void call('PUT', draft, t('Armazenamento salvo. O envio começa em segundo plano.'))}>{t('Salvar')}</button>
      {status.evicted > 0 ? <button type="button" className="koma-outline-button" disabled={busy} onClick={() => void call('POST', { action: 'restore-all' }, t('Baixando os capítulos de volta para o computador.'))}>{t('Trazer tudo para o computador')}</button> : null}
    </div>

    {data.settings.provider !== 'local' ? <div className="flex flex-col gap-1 text-sm" data-storage-status>
      <p><strong>{status.uploaded}</strong> {t('de {total} capítulos prontos guardados na nuvem', { total: status.ready })}{status.pending ? ` · ${t('{n} na fila', { n: status.pending })}` : ''}{status.evicted ? ` · ${t('{n} só na nuvem', { n: status.evicted })}` : ''}.</p>
      {status.uploading !== null ? <p className="koma-note">{t('Enviando um capítulo agora…')}</p> : null}
      {data.space ? <p className="koma-note">{t('Espaço da conta: {used} usados de {total} · {free} livres.', { used: gb(data.space.used, locale), total: gb(data.space.total, locale), free: gb(data.space.free, locale) })}</p> : null}
      {status.lastError ? <p className="text-sm font-semibold">{t('Último problema: {error} O KOMA tenta de novo em alguns minutos.', { error: status.lastError })} <button type="button" className="koma-text-link" disabled={busy} onClick={() => void call('POST', { action: 'sync' }, t('Tentando de novo.'))}>{t('Tentar agora')}</button></p> : null}
    </div> : null}
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
  </>
}
