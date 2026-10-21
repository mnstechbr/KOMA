'use client'
import { useEffect, useState } from 'react'
import { readInkPrefs, saveInkPrefs, type InkPrefs } from '@/components/ink-background'
import { useT } from '@/components/i18n'

// Liga/desliga o fundo que reage ao mouse. Fica só neste computador.
export function AppearanceSettings() {
  const { t } = useT()
  const [prefs, setPrefs] = useState<InkPrefs | null>(null)
  useEffect(() => { setPrefs(readInkPrefs()) }, [])
  function change(update: Partial<InkPrefs>) {
    if (!prefs) return
    const next = { ...prefs, ...update }
    setPrefs(next); saveInkPrefs(next)
  }
  return <>
    <label className="koma-switch"><input type="checkbox" checked={prefs?.live ?? true} disabled={!prefs} onChange={(event) => change({ live: event.target.checked })} /><span>{t('Fundo que reage ao mouse')}<br /><span className="koma-note">{t('A retícula engrossa em volta do ponteiro. Nunca aparece no leitor, pausa quando a janela perde o foco e fica parada se o sistema pedir menos movimento.')}</span></span></label>
    <label className="koma-switch"><input type="checkbox" checked={prefs?.ink ?? true} disabled={!prefs || !prefs.live} onChange={(event) => change({ ink: event.target.checked })} /><span>{t('Mancha de tinta seguindo o ponteiro')}<br /><span className="koma-note">{t('Uma gota de nanquim acompanha o mouse e espirra respingos em movimentos rápidos.')}</span></span></label>
  </>
}
