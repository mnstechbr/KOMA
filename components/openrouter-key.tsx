'use client'

import { useEffect, useState } from 'react'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { useT } from './i18n'

// Chave do OpenRouter, guardada no KOMA (criptografada). Nunca volta para a tela.
export function OpenRouterKey() {
  const { t } = useT()
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<{ hasApiKey: boolean; isValid: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    void fetch('/api/openrouter', { cache: 'no-store' })
      .then((response) => response.json())
      .then(setStatus)
      .catch(() => setMessage(t('Não foi possível consultar a chave do OpenRouter.')))
  }, [t])
  async function call(method: 'PUT' | 'DELETE') {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/openrouter', {
        method,
        headers: method === 'PUT' ? { 'Content-Type': 'application/json' } : undefined,
        body: method === 'PUT' ? JSON.stringify({ apiKey: apiKey.trim() }) : undefined,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message)
      setStatus({ hasApiKey: data.hasApiKey, isValid: data.isValid })
      setApiKey('')
      setMessage(t(data.message))
    } catch (error) {
      setMessage(error instanceof Error && error.message ? t(error.message) : t('Não foi possível salvar.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2">
      <Label htmlFor="openrouter-api-key">{t('Chave do OpenRouter')}</Label>
      <Input
        id="openrouter-api-key"
        type="password"
        autoComplete="off"
        placeholder="sk-or-v1-..."
        value={apiKey}
        disabled={busy}
        onChange={(event) => setApiKey(event.target.value)}
      />
      <p className="koma-note">
        {status === null
          ? t('Consultando…')
          : status.hasApiKey
            ? status.isValid
              ? t('Chave salva e aceita pelo OpenRouter.')
              : t('Há uma chave salva, mas o OpenRouter não a aceitou.')
            : t('Nenhuma chave salva.')}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="koma-outline-button" disabled={busy || !apiKey.trim()} onClick={() => void call('PUT')}>
          {t('Salvar chave')}
        </button>
        {status?.hasApiKey ? (
          <button type="button" className="koma-outline-button" disabled={busy} onClick={() => void call('DELETE')}>
            {t('Remover chave')}
          </button>
        ) : null}
      </div>
      <p role="status" className="text-sm">
        {message}
      </p>
    </div>
  )
}
