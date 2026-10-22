'use client'

import { useEffect, useState } from 'react'
import { useT } from './i18n'
import { SettingsSkeleton } from './koma-skeletons'

type Profile = 'leve' | 'equilibrado' | 'maximo'
type Mode = 'auto' | Profile
interface Snapshot { mode: Mode; profile: Profile; machine: { cores: number; memoryGb: number }; gpu: boolean | null }

// Quanto do computador o KOMA usa para preparar capítulos.
export function PerformanceSettings() {
  const { t, locale } = useT()
  const [data, setData] = useState<Snapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    void fetch('/api/local/performance', { cache: 'no-store' }).then((response) => response.json()).then(setData).catch(() => setMessage(t('Não foi possível consultar o desempenho.')))
  }, [t])
  async function choose(mode: Mode) {
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/local/performance', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) })
      const body = await response.json()
      if (!response.ok) throw new Error()
      setData(body); setMessage(t('Salvo. A preparação passa a usar este perfil em alguns segundos.'))
    } catch { setMessage(t('Não foi possível salvar.')) }
    finally { setBusy(false) }
  }
  if (!data) return message ? <p className="koma-note">{message}</p> : <SettingsSkeleton />
  const names: Record<Profile, string> = { leve: t('Leve'), equilibrado: t('Equilibrado'), maximo: t('Máximo') }
  const options: Array<{ mode: Mode; title: string; note: string; disabled?: boolean }> = [
    { mode: 'auto', title: t('Automático (recomendado)'), note: t('O KOMA escolhe pelo computador. Agora: {profile}.', { profile: names[data.profile] }) },
    { mode: 'leve', title: t('Leve'), note: t('Para computadores com até 4 núcleos ou até 8 GB de memória. Prepara devagar e deixa o computador livre.') },
    { mode: 'equilibrado', title: t('Equilibrado'), note: t('Usa só o processador, com várias páginas ao mesmo tempo.') },
    { mode: 'maximo', title: t('Máximo'), note: data.gpu === false ? t('Placa de vídeo não disponível neste computador.') : t('Lê o texto das páginas na placa de vídeo, cerca de 3 vezes mais rápido que o Equilibrado.'), disabled: data.gpu === false },
  ]
  return <>
    <p className="text-sm text-muted-foreground">{t('{cores} núcleos · {memory} GB de memória', { cores: data.machine.cores, memory: data.machine.memoryGb.toLocaleString(locale) })} · {data.gpu === null ? t('verificando a placa de vídeo…') : data.gpu ? t('placa de vídeo disponível') : t('sem placa de vídeo compatível')}</p>
    <div className="flex flex-col gap-2">
      {options.map((option) => <label key={option.mode} className="koma-switch">
        <input type="radio" name="performance-mode" id={`performance-${option.mode}`} checked={data.mode === option.mode} disabled={busy || option.disabled} onChange={() => void choose(option.mode)} />
        <span>{option.title}<br /><span className="koma-note">{option.note}</span></span>
      </label>)}
    </div>
    <p className="koma-note">{t('Em qualquer perfil, o KOMA trabalha com prioridade baixa: o que você estiver usando vem primeiro.')}</p>
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
  </>
}
