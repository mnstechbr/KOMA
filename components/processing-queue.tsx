'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Loader2, Pause, Play } from 'lucide-react'
import { preparationLabels, workInQueue, type WorkSummary } from '@/lib/works'
import { BrushProgress, WorkCover } from '@/components/koma-ui'
import { useT } from '@/components/i18n'

const inQueue = workInQueue

// Obra pronta com páginas sendo refeitas: mostra o andamento da revisão.
const revising = (work: WorkSummary) => work.revisionPending > 0 && work.activeChapters === 0 && !work.syncRequested

export function ProcessingQueue() {
  const { t, locale } = useT()
  const [works, setWorks] = useState<WorkSummary[] | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function load() {
      try {
        const response = await fetch('/api/local/works', { signal: controller.signal, cache: 'no-store' })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || t('Não foi possível carregar o processamento.'))
        if (!controller.signal.aborted) setWorks(data.works)
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : t('Não foi possível carregar o processamento.'))
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, document.visibilityState === 'visible' ? 4000 : 10000)
      }
    }
    void load()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [tick, t])
  async function control(work: WorkSummary, action: 'pause' | 'resume') {
    setBusy(work.id)
    setMessage('')
    try {
      const response = await fetch(`/api/local/works/${work.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!response.ok) throw new Error((await response.json()).message || t('Não foi possível realizar esta ação.'))
      setMessage(
        action === 'pause'
          ? t('{title}: pausa solicitada. As etapas concluídas permanecem salvas.', { title: work.title })
          : t('{title}: preparação retomada de onde parou.', { title: work.title }),
      )
      setTick((value) => value + 1)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('Não foi possível realizar a ação.'))
    } finally {
      setBusy(null)
    }
  }

  const queue = (works || []).filter(inQueue)
  const total = (works || []).reduce((sum, work) => sum + work.totalChapters, 0)
  const ready = (works || []).reduce((sum, work) => sum + work.readyChapters, 0)
  const pages = (works || []).reduce((sum, work) => sum + work.preparedPages, 0)
  return (
    <div data-processing-state={works ? 'ready' : 'loading'}>
      <header className="koma-page-head">
        <div>
          <h1>{t('Processamento')}</h1>
          <p>
            {t(
              'O KOMA baixa, reconhece e traduz os capítulos em segundo plano, alternando entre as obras. Nada aqui precisa de você, a não ser quando uma obra pedir atenção.',
            )}
          </p>
        </div>
      </header>
      {works ? (
        <div className="koma-queue-summary">
          <div className="koma-stat">
            <strong>{ready}</strong>
            <span>{t('de {total} capítulos prontos', { total })}</span>
          </div>
          <div className="koma-stat">
            <strong>{total - ready}</strong>
            <span>{t('na fila')}</span>
          </div>
          <div className="koma-stat">
            <strong>{pages}</strong>
            <span>{t('páginas preparadas')}</span>
          </div>
        </div>
      ) : null}
      <p role="status" className="koma-status mb-4">
        {message}
      </p>
      {!works ? (
        <p role="status" className="koma-note">
          <Loader2 size={16} className="mr-2 inline animate-spin" aria-hidden="true" />
          {t('Consultando a fila…')}
        </p>
      ) : !queue.length ? (
        <section className="koma-empty">
          <span className="koma-stamp is-ink">{t('Tudo pronto')}</span>
          <h2>{works.length ? t('Todos os capítulos estão prontos para ler.') : t('Nenhuma obra na biblioteca ainda.')}</h2>
          <p>
            {works.length
              ? t('Quando novos capítulos forem encontrados, a preparação aparece aqui automaticamente.')
              : t('Adicione uma obra e acompanhe a preparação por aqui.')}
          </p>
          <Link className="koma-outline-button" href={works.length ? '/inicio/secoes' : '/inicio/obras/nova'}>
            {works.length ? t('Voltar à biblioteca') : t('Adicionar obra')}
          </Link>
        </section>
      ) : (
        <ol className="koma-queue">
          {queue.map((work) => {
            const attention = ['error', 'blocked'].includes(work.stage) || work.translationWait?.manual
            return (
              <li key={work.id} className="koma-queue-row">
                <Link href={`/inicio/obras/${work.id}`} className="koma-queue-thumb" aria-label={t('Abrir {title}', { title: work.title })}>
                  <WorkCover work={work} sizes="84px" t={t} />
                </Link>
                <div className="koma-queue-main">
                  <h2>
                    <Link href={`/inicio/obras/${work.id}`}>{work.title}</Link>
                  </h2>
                  {revising(work) ? (
                    <>
                      <p>
                        {t('Revisando leitura e desenho das páginas')} ·{' '}
                        {t('{done} de {total} páginas revisadas', {
                          done: work.downloadedPages - work.revisionPending,
                          total: work.downloadedPages,
                        })}
                      </p>
                      <BrushProgress
                        value={work.downloadedPages - work.revisionPending}
                        max={work.downloadedPages}
                        label={t('Páginas revisadas de {title}', { title: work.title })}
                        red
                      />
                    </>
                  ) : (
                    <>
                      <p>
                        {work.syncRequested
                          ? t('Buscando a lista de capítulos')
                          : preparationLabels[work.stage]
                            ? t(preparationLabels[work.stage])
                            : t('Na fila')}{' '}
                        · {t('{ready} de {total} prontos', { ready: work.readyChapters, total: work.totalChapters })} ·{' '}
                        {t('{n} com originais baixados', { n: work.downloadedChapters })}
                      </p>
                      <BrushProgress
                        value={work.readyChapters}
                        max={work.totalChapters}
                        label={t('Capítulos prontos de {title}', { title: work.title })}
                        red
                      />
                      {work.revisionPending > 0 ? (
                        <p className="koma-note">{t('{n} páginas em revisão de leitura e desenho', { n: work.revisionPending })}</p>
                      ) : null}
                    </>
                  )}
                  {work.translationWait ? (
                    <p>
                      {work.translationWait.message}{' '}
                      {work.translationWait.manual
                        ? t('Autorize no KPassword e retome.')
                        : t('Nova tentativa às {time}.', { time: new Date(work.translationWait.retryAt).toLocaleTimeString(locale) })}
                    </p>
                  ) : null}
                  {work.message ? <p>{work.message}</p> : null}
                </div>
                <div className="koma-actions">
                  {attention ? <span className="koma-stamp">{t('Precisa de atenção')}</span> : null}
                  <button
                    type="button"
                    className="koma-outline-button"
                    disabled={busy === work.id}
                    onClick={() => void control(work, work.paused || attention ? 'resume' : 'pause')}
                  >
                    {work.paused || attention ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
                    {work.paused ? t('Retomar') : attention ? t('Tentar novamente') : t('Pausar')}
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
