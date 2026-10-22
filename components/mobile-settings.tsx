'use client'

import { useEffect, useState } from 'react'
import { useT } from './i18n'

interface Mobile {
  enabled: boolean
  port: number
  code: string
  addresses: string[]
  qr: string | null
}

// "Ler no celular": servidor só da rede de casa, com QR code e código de acesso.
export function MobileSettings() {
  const { t } = useT()
  const [value, setValue] = useState<Mobile | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    void fetch('/api/local/mobile', { cache: 'no-store' })
      .then((response) => response.json())
      .then(setValue)
      .catch(() => setMessage(t('Não foi possível consultar as preferências.')))
  }, [t])
  async function save(change: { enabled?: boolean; renew?: boolean }) {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/local/mobile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      })
      if (!response.ok) throw new Error()
      setValue(await response.json())
      if (change.renew) setMessage(t('Código novo. Os celulares conectados precisam entrar de novo.'))
    } catch {
      setMessage(t('Não foi possível salvar.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <label className="koma-switch">
        <input
          id="mobile-enabled"
          type="checkbox"
          checked={value?.enabled ?? false}
          disabled={busy || !value}
          onChange={(event) => void save({ enabled: event.target.checked })}
        />
        <span>
          {t('Ler no celular pelo Wi-Fi de casa')}
          <br />
          <span className="koma-note">
            {t(
              'O celular precisa estar na mesma rede Wi-Fi do computador e o KOMA precisa estar aberto (pode ser na bandeja). Nada fica disponível na internet. No celular só dá para ler e marcar como lido.',
            )}
          </span>
        </span>
      </label>
      {value?.enabled ? (
        <div className="flex flex-wrap items-start gap-4" data-mobile-access>
          {value.qr ? (
            <div
              className="border-2 border-[#141414] bg-white p-1"
              aria-label={t('QR code para abrir no celular')}
              dangerouslySetInnerHTML={{ __html: value.qr }}
            />
          ) : null}
          <div className="flex flex-col gap-2 text-sm">
            <p>{t('Aponte a câmera do celular para o QR code. Ou abra no navegador do celular:')}</p>
            {value.addresses.length ? (
              value.addresses.map((address) => (
                <code key={address} className="text-base font-bold">
                  {address}
                </code>
              ))
            ) : (
              <p className="koma-note">{t('Nenhuma rede local encontrada. Conecte o computador ao Wi-Fi ou ao roteador.')}</p>
            )}
            <p>
              {t('Código de acesso:')}{' '}
              <strong className="text-lg tracking-widest" data-mobile-code>
                {value.code}
              </strong>
            </p>
            <button type="button" className="koma-outline-button self-start" disabled={busy} onClick={() => void save({ renew: true })}>
              {t('Trocar o código')}
            </button>
            <p className="koma-note">{t('No Windows, permita o KOMA nas redes privadas se o firewall perguntar.')}</p>
          </div>
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="text-sm">
        {message}
      </p>
    </div>
  )
}
