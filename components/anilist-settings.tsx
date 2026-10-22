'use client'

import { useEffect, useState } from 'react'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { useT } from './i18n'

interface Status { connected: boolean; viewer: string | null; clientId: string; authorizeUrl: string | null }

// Progresso de leitura no AniList (opcional), pelo OAuth oficial, sem senha.
export function AniListSettings() {
  const { t } = useT()
  const [status, setStatus] = useState<Status | null>(null)
  const [clientId, setClientId] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { void fetch('/api/local/anilist', { cache: 'no-store' }).then((response) => response.json()).then(setStatus).catch(() => setMessage(t('Não foi possível consultar as preferências.'))) }, [t])
  async function send(method: 'POST' | 'DELETE', body?: object) {
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/local/anilist', { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message)
      setStatus(data); setToken('')
      if (data.synced) setMessage(t('Progresso enviado: {n} obra(s) atualizada(s) no AniList.', { n: data.synced.updated }))
    } catch (error) { setMessage(error instanceof Error && error.message ? t(error.message) : t('Não foi possível salvar.')) }
    finally { setBusy(false) }
  }
  if (!status) return null
  return <div className="flex flex-col gap-3">
    <p className="koma-note">{t('Opcional. Ao marcar um capítulo como lido, o KOMA atualiza o seu progresso no AniList (só aumenta). Você autoriza no site do AniList; o KOMA nunca vê a sua senha.')}</p>
    {status.connected ? <>
      <p className="text-sm">{t('Conectado como {name}.', { name: status.viewer || 'AniList' })}</p>
      <div className="flex flex-wrap gap-2"><button type="button" className="koma-outline-button" disabled={busy} onClick={() => void send('POST', { sync: true })}>{t('Enviar o progresso agora')}</button><button type="button" className="koma-outline-button" disabled={busy} onClick={() => void send('DELETE')}>{t('Desconectar')}</button></div>
    </> : <>
      {!status.clientId ? <div className="space-y-1">
        <Label htmlFor="anilist-client">{t('ID do cliente do AniList')}</Label>
        <p className="koma-note">{t('Crie um cliente em anilist.co/settings/developer com o endereço de retorno https://anilist.co/api/v2/oauth/pin e cole o número dele aqui.')}</p>
        <div className="flex flex-wrap gap-2"><Input id="anilist-client" inputMode="numeric" value={clientId} disabled={busy} onChange={(event) => setClientId(event.target.value)} className="max-w-48" /><button type="button" className="koma-outline-button" disabled={busy || !/^\d+$/.test(clientId.trim())} onClick={() => void send('POST', { clientId: clientId.trim() })}>{t('Salvar')}</button></div>
      </div> : <>
        <p className="text-sm">{t('1. Abra o AniList e autorize o KOMA. 2. Copie o token que aparece e cole abaixo.')}</p>
        {status.authorizeUrl ? <a href={status.authorizeUrl} target="_blank" rel="noreferrer" className="koma-outline-button self-start">{t('Autorizar no AniList')}</a> : null}
        <div className="space-y-1"><Label htmlFor="anilist-token">{t('Token do AniList')}</Label>
          <div className="flex flex-wrap gap-2"><Input id="anilist-token" type="password" autoComplete="off" value={token} disabled={busy} onChange={(event) => setToken(event.target.value)} className="min-w-0 flex-1" /><button type="button" className="koma-outline-button" disabled={busy || token.trim().length < 20} onClick={() => void send('POST', { token: token.trim() })}>{t('Conectar')}</button></div></div>
      </>}
    </>}
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
  </div>
}
