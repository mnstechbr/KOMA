'use client'

import { useCallback, useEffect, useState } from 'react'
import { useT } from './i18n'

type Provider = 'local' | 'gdrive' | 'onedrive' | 'rclone' | 'disk'
interface Settings {
  provider: Provider
  remote: string
  folder: string
  mode: 'mirror' | 'cloud'
  cacheGb: number
  diskId: string
  diskLabel: string
  diskPath: string
  keepChapters: number
}
interface DiskChoice {
  path: string
  label: string
  total: number | null
  free: number | null
  hasKoma: boolean
}
interface Snapshot {
  settings: Settings
  rclone: { installed: boolean; version: string }
  connected: { gdrive: boolean; onedrive: boolean }
  connecting?: Record<'gdrive' | 'onedrive', { running: boolean; error: string }>
  userRemotes: string[]
  active: boolean
  disk: { mount: string | null; choices: DiskChoice[] }
  status: {
    uploaded: number
    pending: number
    evicted: number
    ready: number
    uploading: number | null
    lastError: string
    lastSyncAt: string | null
    localBytes: number
  }
  space: { total: number | null; used: number | null; free: number | null } | null
}

const gb = (bytes: number | null | undefined, locale: string) =>
  bytes == null ? '—' : `${(bytes / 1024 ** 3).toLocaleString(locale, { maximumFractionDigits: 1 })} GB`
const ACCOUNTS: Array<{ id: 'gdrive' | 'onedrive'; name: string }> = [
  { id: 'gdrive', name: 'Google Drive' },
  { id: 'onedrive', name: 'OneDrive' },
]

// Onde ficam os capítulos prontos: no computador, num dispositivo externo
// (HD, SSD, pendrive, cartão, pasta de rede) ou na nuvem do próprio usuário.
export function StorageSettings() {
  const { t, locale } = useT()
  const [data, setData] = useState<Snapshot | null>(null)
  const [draft, setDraft] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/local/storage', { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.message)
      setData(body)
      setDraft((current) => current ?? body.settings)
    } catch {
      setMessage(t('Não foi possível consultar o armazenamento.'))
    }
  }, [t])
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 15000)
    return () => clearInterval(timer)
  }, [refresh])

  // Prepara a pasta do KOMA no dispositivo; a troca só vale depois de "Salvar".
  async function chooseDisk(disk: DiskChoice) {
    if (!draft) return
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/local/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disk-setup', path: disk.path }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message)
      setDraft({ ...draft, provider: 'disk', diskId: result.id, diskLabel: result.label, diskPath: result.path })
      setMessage(t('Dispositivo {name} escolhido. Clique em Salvar para começar.', { name: result.label }))
    } catch (error) {
      setMessage(error instanceof Error && error.message ? t(error.message) : t('Não foi possível concluir.'))
    } finally {
      setBusy(false)
    }
  }

  async function call(method: 'PUT' | 'POST', body: object, done: string) {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/local/storage', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message)
      if (method === 'PUT') {
        setData(result)
        setDraft(result.settings)
      }
      setMessage(done)
      if (method === 'POST') void refresh()
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : t('Não foi possível concluir.'))
    } finally {
      setBusy(false)
    }
  }

  if (!data || !draft) return <p className="koma-note">{t('Consultando…')}</p>
  const status = data.status
  const changed = JSON.stringify(draft) !== JSON.stringify(data.settings)
  const canUse = (provider: Provider) =>
    provider === 'local' || provider === 'rclone' || provider === 'disk' ? true : data.connected[provider]
  const disk = draft.provider === 'disk'
  const savedDisk = data.settings.provider === 'disk'

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {t('O KOMA cria a pasta')} <strong>{draft.folder || 'KOMA'}</strong>{' '}
        {t(
          'no dispositivo externo ou na raiz da sua nuvem. Cada capítulo pronto vai para lá como um arquivo .cbz, com as páginas traduzidas na frente e os originais guardados junto. Esse arquivo abre em qualquer leitor de quadrinhos. O banco da biblioteca e o progresso de leitura continuam no computador.',
        )}
      </p>
      {!data.rclone.installed && !disk ? (
        <p className="text-sm font-semibold">
          {t('Para usar a nuvem, instale o rclone, por exemplo com')} <code>sudo dnf install rclone</code>
          {t(', e reabra esta tela.')}
        </p>
      ) : null}

      <h3 className="koma-pref-sub">{t('Contas')}</h3>
      <ul className="flex flex-col gap-2">
        {ACCOUNTS.map((account) => (
          <li key={account.id} className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">{account.name}</p>
              <p className="text-sm text-muted-foreground">
                <span aria-hidden="true">{data.connected[account.id] ? '● ' : '○ '}</span>
                {data.connected[account.id]
                  ? t('Conectado')
                  : data.connecting?.[account.id]?.running
                    ? t('Aguardando o login no navegador…')
                    : t('Não conectado')}
              </p>
              {!data.connected[account.id] && data.connecting?.[account.id]?.error ? (
                <p className="text-sm font-semibold">{t(data.connecting[account.id].error)}</p>
              ) : null}
            </div>
            {data.connected[account.id] ? (
              <button
                type="button"
                className="koma-outline-button"
                disabled={busy || data.settings.provider === account.id}
                onClick={() =>
                  void call('POST', { action: 'disconnect', provider: account.id }, t('{name} desconectado.', { name: account.name }))
                }
              >
                {t('Desconectar')}
              </button>
            ) : (
              <button
                type="button"
                className="koma-button"
                disabled={busy || !data.rclone.installed}
                onClick={() =>
                  void call(
                    'POST',
                    { action: 'connect', provider: account.id },
                    t('Abrimos o login do {name} no navegador. Depois de entrar, aguarde alguns segundos.', { name: account.name }),
                  )
                }
              >
                {t('Conectar')}
              </button>
            )}
          </li>
        ))}
      </ul>

      <h3 className="koma-pref-sub">{t('Onde guardar os capítulos')}</h3>
      <div className="flex flex-col gap-2">
        {(['local', 'disk', 'gdrive', 'onedrive', 'rclone'] as Provider[]).map((provider) => (
          <label key={provider} className="koma-switch">
            <input
              type="radio"
              name="storage-provider"
              checked={draft.provider === provider}
              disabled={busy || !canUse(provider)}
              onChange={() => setDraft({ ...draft, provider })}
            />
            <span>
              {provider === 'local'
                ? t('Só neste computador')
                : provider === 'disk'
                  ? t('Dispositivo externo (HD, SSD, pendrive, cartão de memória)')
                  : provider === 'gdrive'
                    ? 'Google Drive'
                    : provider === 'onedrive'
                      ? 'OneDrive'
                      : t('Outro serviço do rclone (Dropbox, MEGA, Nextcloud…)')}
              {!canUse(provider) ? <span className="koma-note"> · {t('conecte a conta primeiro')}</span> : null}
            </span>
          </label>
        ))}
      </div>
      {draft.provider === 'rclone' ? (
        <label className="flex flex-col gap-1 text-sm">
          {t('Remoto do seu rclone')}
          <select
            className="h-10 rounded-[4px] border-2 border-input bg-background px-3 text-sm"
            value={draft.remote}
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, remote: event.target.value })}
          >
            <option value="">{t('Escolha…')}</option>
            {data.userRemotes.map((remote) => (
              <option key={remote} value={remote}>
                {remote}
              </option>
            ))}
          </select>
          <span className="koma-note">
            {t('Configure novos serviços com')} <code>rclone config</code> {t('no terminal.')}
          </span>
        </label>
      ) : null}
      {disk ? (
        <div className="flex flex-col gap-2 text-sm" data-storage-disks>
          {draft.diskId ? (
            <p>
              {t('Dispositivo escolhido:')} <strong>{draft.diskLabel}</strong>
              {savedDisk && data.settings.diskId === draft.diskId ? (
                <span className="koma-note"> · {data.disk.mount ? t('conectado') : t('desconectado')}</span>
              ) : null}
            </p>
          ) : (
            <p className="koma-note">{t('Conecte o dispositivo e escolha ele na lista.')}</p>
          )}
          {data.disk.choices.length ? (
            <ul className="flex flex-col gap-2">
              {data.disk.choices.map((choice) => (
                <li key={choice.path} className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{choice.label}</p>
                    <p className="koma-note">
                      {choice.free != null
                        ? t('{free} livres de {total}', { free: gb(choice.free, locale), total: gb(choice.total, locale) })
                        : choice.path}
                      {choice.hasKoma ? ` · ${t('já tem a pasta do KOMA')}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="koma-outline-button"
                    disabled={busy || (draft.diskPath === choice.path && Boolean(draft.diskId))}
                    onClick={() => void chooseDisk(choice)}
                  >
                    {draft.diskPath === choice.path && draft.diskId ? t('Escolhido') : t('Usar este')}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="koma-note">{t('Nenhum dispositivo externo conectado agora.')}</p>
          )}
        </div>
      ) : null}
      {disk ? (
        <>
          <label className="koma-switch">
            <input
              type="radio"
              name="storage-mode"
              checked={draft.mode === 'cloud'}
              disabled={busy}
              onChange={() => setDraft({ ...draft, mode: 'cloud' })}
            />
            <span>
              {t('Só os capítulos recentes no computador')}
              <br />
              <span className="koma-note">
                {t(
                  'De cada obra, ficam no computador os {n} capítulos mais novos e os {n} próximos que você ainda não leu. Os outros ficam só no dispositivo, depois de conferidos byte a byte. Com o dispositivo conectado, um capítulo antigo abre em segundos e fica no computador por 2 dias; sem ele, o KOMA pede para conectar.',
                  { n: draft.keepChapters },
                )}
              </span>
            </span>
          </label>
          <label className="koma-switch">
            <input
              type="radio"
              name="storage-mode"
              checked={draft.mode === 'mirror'}
              disabled={busy}
              onChange={() => setDraft({ ...draft, mode: 'mirror' })}
            />
            <span>
              {t('No computador e no dispositivo')}
              <br />
              <span className="koma-note">
                {t('O dispositivo funciona como cópia de segurança. Ocupa o mesmo espaço de hoje no computador.')}
              </span>
            </span>
          </label>
          {draft.mode === 'cloud' ? (
            <label className="flex flex-col gap-1 text-sm">
              {t('Capítulos mais novos e próximos que ficam no computador')}
              <input
                type="number"
                min={1}
                max={50}
                step={1}
                className="h-10 w-32 rounded-[4px] border-2 border-input bg-background px-3 text-sm"
                value={draft.keepChapters}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, keepChapters: Number(event.target.value) })}
              />
            </label>
          ) : null}
        </>
      ) : null}
      {draft.provider !== 'local' && !disk ? (
        <>
          <label className="flex flex-col gap-1 text-sm">
            {t('Nome da pasta na nuvem')}
            <input
              className="h-10 rounded-[4px] border-2 border-input bg-background px-3 text-sm"
              value={draft.folder}
              maxLength={80}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, folder: event.target.value })}
            />
          </label>
          <label className="koma-switch">
            <input
              type="radio"
              name="storage-mode"
              checked={draft.mode === 'mirror'}
              disabled={busy}
              onChange={() => setDraft({ ...draft, mode: 'mirror' })}
            />
            <span>
              {t('No computador e na nuvem')}
              <br />
              <span className="koma-note">
                {t('A nuvem funciona como cópia de segurança. Ocupa o mesmo espaço de hoje no computador.')}
              </span>
            </span>
          </label>
          <label className="koma-switch">
            <input
              type="radio"
              name="storage-mode"
              checked={draft.mode === 'cloud'}
              disabled={busy}
              onChange={() => setDraft({ ...draft, mode: 'cloud' })}
            />
            <span>
              {t('Só na nuvem, com espaço limitado no computador')}
              <br />
              <span className="koma-note">
                {t(
                  'Os capítulos já conferidos na nuvem saem do computador quando passam do limite. Os 3 próximos de cada obra ficam sempre aqui. Ao abrir um capítulo que está só na nuvem, ele é baixado em alguns segundos.',
                )}
              </span>
            </span>
          </label>
          {draft.mode === 'cloud' ? (
            <label className="flex flex-col gap-1 text-sm">
              {t('Espaço máximo no computador (GB)')}
              <input
                type="number"
                min={0.5}
                max={500}
                step={0.5}
                className="h-10 w-32 rounded-[4px] border-2 border-input bg-background px-3 text-sm"
                value={draft.cacheGb}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, cacheGb: Number(event.target.value) })}
              />
            </label>
          ) : null}
        </>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="koma-button"
          disabled={busy || !changed || (disk && !draft.diskId)}
          onClick={() => void call('PUT', draft, t('Armazenamento salvo. O envio começa em segundo plano.'))}
        >
          {t('Salvar')}
        </button>
        {status.evicted > 0 ? (
          <button
            type="button"
            className="koma-outline-button"
            disabled={busy}
            onClick={() => void call('POST', { action: 'restore-all' }, t('Baixando os capítulos de volta para o computador.'))}
          >
            {t('Trazer tudo para o computador')}
          </button>
        ) : null}
      </div>

      {savedDisk ? (
        <div className="flex flex-col gap-1 text-sm" data-storage-status>
          <p>
            <strong>{status.uploaded}</strong> {t('de {total} capítulos prontos guardados no dispositivo', { total: status.ready })}
            {status.pending ? ` · ${t('{n} na fila', { n: status.pending })}` : ''}
            {status.evicted ? ` · ${t('{n} só no dispositivo', { n: status.evicted })}` : ''}.
          </p>
          {status.localBytes ? (
            <p className="koma-note">{t('{size} liberados no computador.', { size: gb(status.localBytes, locale) })}</p>
          ) : null}
          {!data.disk.mount ? (
            <p className="font-semibold">
              {t('{name} está desconectado. A cópia continua quando ele for conectado de novo.', { name: data.settings.diskLabel })}
            </p>
          ) : null}
          {status.uploading !== null ? <p className="koma-note">{t('Copiando um capítulo agora…')}</p> : null}
          {data.space ? (
            <p className="koma-note">
              {t('Espaço no dispositivo: {free} livres de {total}.', {
                free: gb(data.space.free, locale),
                total: gb(data.space.total, locale),
              })}
            </p>
          ) : null}
          {status.lastError ? (
            <p className="text-sm font-semibold">
              {t('Último problema: {error} O KOMA tenta de novo em alguns minutos.', { error: status.lastError })}
            </p>
          ) : null}
        </div>
      ) : data.settings.provider !== 'local' ? (
        <div className="flex flex-col gap-1 text-sm" data-storage-status>
          <p>
            <strong>{status.uploaded}</strong> {t('de {total} capítulos prontos guardados na nuvem', { total: status.ready })}
            {status.pending ? ` · ${t('{n} na fila', { n: status.pending })}` : ''}
            {status.evicted ? ` · ${t('{n} só na nuvem', { n: status.evicted })}` : ''}.
          </p>
          {status.uploading !== null ? <p className="koma-note">{t('Enviando um capítulo agora…')}</p> : null}
          {data.space ? (
            <p className="koma-note">
              {t('Espaço da conta: {used} usados de {total} · {free} livres.', {
                used: gb(data.space.used, locale),
                total: gb(data.space.total, locale),
                free: gb(data.space.free, locale),
              })}
            </p>
          ) : null}
          {status.lastError ? (
            <p className="text-sm font-semibold">
              {t('Último problema: {error} O KOMA tenta de novo em alguns minutos.', { error: status.lastError })}{' '}
              <button
                type="button"
                className="koma-text-link"
                disabled={busy}
                onClick={() => void call('POST', { action: 'sync' }, t('Tentando de novo.'))}
              >
                {t('Tentar agora')}
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="text-sm">
        {message}
      </p>
    </>
  )
}
