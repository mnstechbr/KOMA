'use client'

import { useCallback, useEffect, useState } from 'react'
import { useT } from './i18n'

type Subscription = { id: 'claude-code' | 'chatgpt-codex'; name: string; installed: boolean; connected: boolean; detail: string }

// Assinaturas Claude e ChatGPT usadas como provedores de tradução: mostra se o
// login dos programas oficiais está ativo e abre o login quando não está.
export function SubscriptionConnections({ only }: { only?: Subscription['id'] } = {}) {
  const { t } = useT()
  const [items, setItems] = useState<Subscription[] | null>(null)
  const [message, setMessage] = useState('')
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/local/subscriptions', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message)
      setItems(data.subscriptions)
    } catch {
      setMessage(t('Não foi possível verificar as assinaturas.'))
    }
  }, [t])
  useEffect(() => {
    void refresh()
  }, [refresh])
  async function connect(id: Subscription['id']) {
    setMessage(t('Abrindo o login no navegador. Depois de entrar, clique em Verificar.'))
    try {
      const response = await fetch('/api/local/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!response.ok) throw new Error()
    } catch {
      setMessage(t('Não foi possível abrir o login.'))
    }
  }
  return (
    <>
      <p className="koma-note">{t('Usa o login do Claude Code ou do Codex deste computador e consome o limite de uso do seu plano.')}</p>
      <ul className="space-y-2">
        {(items || [])
          .filter((item) => !only || item.id === only)
          .map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{t(item.name)}</p>
                <p className="text-sm text-muted-foreground">
                  <span aria-hidden="true">{item.connected ? '● ' : '○ '}</span>
                  {item.connected ? t('Conectada') : t('Não conectada')} · {t(item.detail)}
                </p>
              </div>
              {item.connected ? null : (
                <button type="button" className="koma-button" disabled={!item.installed} onClick={() => void connect(item.id)}>
                  {t('Conectar')}
                </button>
              )}
            </li>
          ))}
      </ul>
      {items === null ? <p className="text-sm text-muted-foreground">{t('Verificando…')}</p> : null}
      <button
        type="button"
        className="koma-outline-button"
        onClick={() => {
          setMessage('')
          void refresh()
        }}
      >
        {t('Verificar novamente')}
      </button>
      <p role="status" className="text-sm">
        {message}
      </p>
    </>
  )
}
