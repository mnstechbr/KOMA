'use client'

import { useEffect, useState } from 'react'
import { useT } from './i18n'

interface Settings { tray: boolean; autostart: boolean; notify: boolean; checkHour: number | null }

// Coleta em segundo plano: bandeja, início com o computador, procura diária e avisos.
export function BackgroundSettings() {
  const { t } = useT()
  const [value, setValue] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    void fetch('/api/local/background', { cache: 'no-store' }).then((response) => response.json()).then((data) => setValue({ tray: data.tray, autostart: data.autostart, notify: data.notify, checkHour: data.checkHour })).catch(() => setMessage(t('Não foi possível consultar as preferências.')))
  }, [t])
  async function save(change: Partial<Settings>) {
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/local/background', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message)
      setValue(data); setMessage(t('Salvo.'))
    } catch { setMessage(t('Não foi possível salvar.')) }
    finally { setBusy(false) }
  }
  const disabled = busy || !value
  return <div className="flex flex-col gap-4">
    <label className="koma-switch"><input id="background-tray" type="checkbox" checked={value?.tray ?? false} disabled={disabled} onChange={(event) => void save({ tray: event.target.checked, ...(!event.target.checked ? { autostart: false } : {}) })} />
      <span>{t('Continuar no ícone da bandeja ao fechar a janela')}<br /><span className="koma-note">{t('O KOMA segue baixando e preparando capítulos. Para encerrar de vez, use Sair no menu do ícone ou no menu KOMA. Sem ícone na barra do sistema, abra o KOMA pelo menu de aplicativos para ver a janela de novo.')}</span></span></label>
    <label className="koma-switch"><input id="background-autostart" type="checkbox" checked={value?.autostart ?? false} disabled={disabled || !value?.tray} onChange={(event) => void save({ autostart: event.target.checked })} />
      <span>{t('Iniciar com o computador')}<br /><span className="koma-note">{t('Abre escondido na bandeja, sem mostrar a janela.')}</span></span></label>
    <div className="space-y-1">
      <label htmlFor="background-hour" className="text-sm font-medium">{t('Procurar capítulos novos')}</label>
      <select id="background-hour" className="h-10 w-full max-w-sm rounded-[4px] border-2 border-input bg-background px-3 text-sm" value={value?.checkHour ?? 'off'} disabled={disabled} onChange={(event) => void save({ checkHour: event.target.value === 'off' ? null : Number(event.target.value) })}>
        <option value="off">{t('Só quando eu pedir')}</option>
        {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{t('Todo dia a partir das {hour}h', { hour: String(hour).padStart(2, '0') })}</option>)}
      </select>
      <p className="koma-note">{t('Com o computador desligado nesse horário, a procura acontece quando o KOMA abrir depois dele. Os capítulos são preparados com prioridade baixa, no perfil de desempenho escolhido.')}</p>
    </div>
    <label className="koma-switch"><input id="background-notify" type="checkbox" checked={value?.notify ?? false} disabled={disabled} onChange={(event) => void save({ notify: event.target.checked })} />
      <span>{t('Avisar quando um capítulo novo ficar pronto')}<br /><span className="koma-note">{t('Clique no aviso para abrir o capítulo no leitor.')}</span></span></label>
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
  </div>
}
