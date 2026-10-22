'use client'

import { useEffect, useState } from 'react'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { useT } from './i18n'

type Status = { hasApiKey: boolean; isValid: boolean; usage: { used: number; limit: number } | null }

// Chave do DeepL API Free, guardada no KOMA (criptografada), e o consumo da franquia.
export function DeeplKey() {
  const { t, locale } = useT()
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    void fetch('/api/deepl', { cache: 'no-store' }).then((response) => response.json()).then(setStatus).catch(() => setMessage(t('Não foi possível consultar a chave do DeepL.')))
  }, [t])
  async function call(method: 'PUT' | 'DELETE') {
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/deepl', { method, headers: method === 'PUT' ? { 'Content-Type': 'application/json' } : undefined, body: method === 'PUT' ? JSON.stringify({ apiKey: apiKey.trim() }) : undefined })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message)
      setStatus({ hasApiKey: data.hasApiKey, isValid: data.isValid, usage: data.usage }); setApiKey(''); setMessage(t(data.message))
    } catch (error) { setMessage(error instanceof Error && error.message ? t(error.message) : t('Não foi possível salvar.')) }
    finally { setBusy(false) }
  }
  const number = (value: number) => value.toLocaleString(locale)
  return <div className="space-y-2">
    <p className="koma-note">{t('Grátis dentro da franquia mensal de uma conta DeepL API Free. Crie a conta em deepl.com/pro-api e copie a chave de autenticação (termina em :fx). O DeepL traduz fala por fala, sem o contexto do capítulo.')}</p>
    <Label htmlFor="deepl-api-key">{t('Chave do DeepL API Free')}</Label>
    <Input id="deepl-api-key" type="password" autoComplete="off" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx" value={apiKey} disabled={busy} onChange={(event) => setApiKey(event.target.value)} />
    <p className="koma-note">{status === null ? t('Consultando…') : status.hasApiKey ? (status.isValid ? t('Chave salva e aceita pelo DeepL.') : t('Há uma chave salva, mas o DeepL não a aceitou.')) : t('Nenhuma chave salva.')}</p>
    {status?.usage ? <p className="text-sm" data-deepl-usage>{t('Franquia deste mês: {used} de {limit} caracteres usados.', { used: number(status.usage.used), limit: number(status.usage.limit) })}</p> : null}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="koma-outline-button" disabled={busy || !apiKey.trim()} onClick={() => void call('PUT')}>{t('Salvar chave')}</button>
      {status?.hasApiKey ? <button type="button" className="koma-outline-button" disabled={busy} onClick={() => void call('DELETE')}>{t('Remover chave')}</button> : null}
    </div>
    <p role="status" className="text-sm">{message}</p>
  </div>
}
