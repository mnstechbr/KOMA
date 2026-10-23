'use client'

import { useCallback, useEffect, useState } from 'react'
import { useT } from './i18n'
import { BrushProgress } from './koma-ui'

interface Status {
  supported: boolean
  reason: 'platform' | 'no-nvidia' | 'old-driver' | null
  driver: number | null
  installed: boolean
  enabled: boolean
  accepted: boolean
  downloadBytes: number
  diskBytes: number
  freeBytes: number | null
  dir: string
  licenses: Array<{ name: string; url: string }>
  job: { running: boolean; phase: string; done: number; total: number; error: string }
  drawDevice: string
  cudaError: string | null
}

// Complemento CUDA (opcional, só NVIDIA no Linux): acelera o desenho no perfil Máximo.
export function CudaAddon() {
  const { t, locale } = useT()
  const [status, setStatus] = useState<Status | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [message, setMessage] = useState('')
  const load = useCallback(
    () =>
      fetch('/api/local/performance/cuda', { cache: 'no-store' })
        .then((response) => response.json())
        .then(setStatus)
        .catch(() => undefined),
    [],
  )
  useEffect(() => {
    void load()
  }, [load])
  // Enquanto baixa, atualiza o progresso a cada segundo.
  useEffect(() => {
    if (!status?.job.running) return
    const timer = setInterval(() => void load(), 1000)
    return () => clearInterval(timer)
  }, [status?.job.running, load])
  async function act(action: string, extra: Record<string, unknown> = {}) {
    setMessage('')
    const response = await fetch('/api/local/performance/cuda', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    if (!response?.ok) setMessage(body?.message || t('Não foi possível concluir.'))
    else setStatus(body)
  }
  if (!status) return null
  // Fora do Linux com NVIDIA o complemento nem aparece; só quem já tem a pasta vê como remover.
  if (!status.supported && !status.installed) return null
  const gb = (bytes: number) => (bytes / 1024 ** 3).toLocaleString(locale, { maximumFractionDigits: 1 })
  const job = status.job
  const lowDisk = status.freeBytes !== null && status.freeBytes < status.diskBytes + status.downloadBytes
  return (
    <section className="flex flex-col gap-2">
      <h3 className="koma-pref-sub">{t('Aceleração CUDA (opcional)')}</h3>
      <p className="koma-note">
        {t(
          'Complemento para placas NVIDIA: no perfil Máximo, o apagamento do texto (máscara e LaMa) passa a usar CUDA; a leitura continua na placa via WebGPU.',
        )}
      </p>
      {status.cudaError ? (
        <p className="koma-alert" role="alert">
          {t('O CUDA falhou e o desenho voltou para a placa via WebGPU: {error}', { error: status.cudaError })}
        </p>
      ) : null}
      {job.running ? (
        <>
          <BrushProgress value={job.done} max={Math.max(1, job.total)} label={t('Baixando o CUDA')} />
          <p className="koma-note" role="status" aria-live="polite">
            {job.phase === 'extracting'
              ? t('Extraindo e conferindo os arquivos…')
              : job.phase === 'checking'
                ? t('Conferindo os arquivos…')
                : t('Baixando: {done} de {total} GB', { done: gb(job.done), total: gb(job.total) })}
          </p>
          <div>
            <button type="button" className="koma-outline-button" onClick={() => void act('cancel')}>
              {t('Cancelar (dá para retomar depois)')}
            </button>
          </div>
        </>
      ) : status.installed ? (
        <>
          <label className="koma-switch">
            <input type="checkbox" checked={status.enabled} onChange={(event) => void act(event.target.checked ? 'enable' : 'disable')} />
            <span>
              {t('Usar CUDA no desenho (perfil Máximo)')}
              <br />
              <span className="koma-note">
                {status.drawDevice === 'cuda'
                  ? t('Em uso agora.')
                  : status.enabled
                    ? t('Entra em uso quando o perfil for Máximo.')
                    : t('Desligado: o desenho usa a placa via WebGPU.')}
              </span>
            </span>
          </label>
          <div>
            <button type="button" className="koma-outline-button" onClick={() => void act('remove')}>
              {t('Remover o CUDA e liberar {size} GB', { size: gb(status.diskBytes) })}
            </button>
          </div>
        </>
      ) : confirming ? (
        <div className="koma-box flex flex-col gap-2">
          <p>{t('Antes de baixar, saiba exatamente o que muda:')}</p>
          <ul className="koma-note list-disc pl-5">
            <li>
              {t('Download de {size} GB dos servidores oficiais da NVIDIA (PyPI) e da Microsoft (NuGet), conferidos por SHA-256.', {
                size: gb(status.downloadBytes),
              })}
            </li>
            <li>
              {t('Ocupa {size} GB em disco, em {dir}. Livre agora: {free} GB.', {
                size: gb(status.diskBytes),
                dir: status.dir,
                free: status.freeBytes === null ? '?' : gb(status.freeBytes),
              })}
            </li>
            <li>
              {t(
                'Ganho medido numa RTX 3070, no perfil Máximo: 14 a 22% menos tempo em mangá e tiras longas; manhwa igual. Em outras placas o ganho pode ser maior, menor ou nenhum.',
              )}
            </li>
            <li>{t('Usa cerca de 1,1 GB a mais de memória enquanto prepara capítulos.')}</li>
            <li>
              {t(
                'O texto lido não muda. As páginas desenhadas podem ter diferenças mínimas de arredondamento (cerca de 0,4% dos pixels, invisíveis).',
              )}
            </li>
            <li>
              {t(
                'Só funciona com placa NVIDIA. Se algum arquivo faltar ou o CUDA falhar, o KOMA volta sozinho para o WebGPU e avisa aqui.',
              )}
            </li>
            <li>{t('Dá para desligar ou remover a qualquer momento.')}</li>
          </ul>
          <p className="koma-note">
            {t('Licenças:')}{' '}
            {status.licenses.map((license, index) => (
              <span key={license.url}>
                {index ? ' · ' : ''}
                <a href={license.url} target="_blank" rel="noreferrer">
                  {license.name}
                </a>
              </span>
            ))}
          </p>
          <label className="koma-switch">
            <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
            <span>{t('Li e aceito as licenças da NVIDIA para baixar e usar essas bibliotecas.')}</span>
          </label>
          {lowDisk ? <p className="koma-alert">{t('Não há espaço livre suficiente em disco.')}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              className="koma-button"
              disabled={!accepted || lowDisk}
              onClick={() => {
                setConfirming(false)
                void act('install', { accept: true })
              }}
            >
              {status.downloadBytes ? t('Baixar {size} GB', { size: gb(status.downloadBytes) }) : t('Instalar')}
            </button>
            <button type="button" className="koma-outline-button" onClick={() => setConfirming(false)}>
              {t('Agora não')}
            </button>
          </div>
        </div>
      ) : (
        <div>
          {job.error && job.error !== 'canceled' ? (
            <p className="koma-alert" role="alert">
              {t('O download falhou: {error}', { error: job.error })}
            </p>
          ) : null}
          <button type="button" className="koma-outline-button" onClick={() => setConfirming(true)}>
            {job.error === 'canceled' ? t('Retomar o download do CUDA') : t('Baixar aceleração CUDA (opcional)')}
          </button>
        </div>
      )}
      {message ? (
        <p className="text-sm" role="status">
          {message}
        </p>
      ) : null}
    </section>
  )
}
