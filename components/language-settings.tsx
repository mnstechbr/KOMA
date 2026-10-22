'use client'

import { useEffect, useState } from 'react'
import { useT } from './i18n'
import { TARGET_LANGUAGES, UI_LANGUAGES, type TargetLanguage, type UiLanguage } from '@/lib/languages'

// Idioma das telas e idioma para o qual as novas obras são traduzidas.
export function LanguageSettings() {
  const { t } = useT()
  const [value, setValue] = useState<{ ui: UiLanguage; target: TargetLanguage } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    void fetch('/api/local/language', { cache: 'no-store' })
      .then((response) => response.json())
      .then(setValue)
      .catch(() => setMessage(t('Não foi possível consultar o idioma.')))
  }, [t])

  async function save(update: Partial<{ ui: UiLanguage; target: TargetLanguage }>) {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/local/language', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message)
      setValue(data)
      // Troca de idioma da interface: recarrega para todas as telas mudarem juntas.
      if (update.ui) window.location.reload()
      else setMessage(t('Salvo. As próximas obras que você adicionar serão traduzidas para este idioma.'))
    } catch {
      setMessage(t('Não foi possível salvar o idioma.'))
    } finally {
      setBusy(false)
    }
  }

  if (!value) return <p className="koma-note">{t('Consultando…')}</p>
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        {t('Idioma das telas')}
        <select
          id="ui-language"
          className="h-10 w-full max-w-sm rounded-[4px] border-2 border-input bg-background px-3 text-sm"
          value={value.ui}
          disabled={busy}
          onChange={(event) => void save({ ui: event.target.value as UiLanguage })}
        >
          {UI_LANGUAGES.map((item) => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t('Traduzir as novas obras para')}
        <select
          id="target-language"
          className="h-10 w-full max-w-sm rounded-[4px] border-2 border-input bg-background px-3 text-sm"
          value={value.target}
          disabled={busy}
          onChange={(event) => void save({ target: event.target.value as TargetLanguage })}
        >
          {TARGET_LANGUAGES.map((item) => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <p className="koma-note">
        {t(
          'Cada obra guarda o idioma escolhido quando foi adicionada. As obras que já estão na biblioteca continuam no idioma delas. Capítulos encontrados já nesse idioma são usados sem tradução.',
        )}
      </p>
      <p role="status" aria-live="polite" className="text-sm">
        {message}
      </p>
    </>
  )
}
