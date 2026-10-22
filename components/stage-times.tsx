'use client'

import { useEffect, useState } from 'react'
import { useT } from './i18n'

interface Report {
  chapters: Array<{ chapterId: number; at: string; work: string; number: string | null; pages: number; downloadMs: number; ocrMs: number; translateMs: number }>
  average: { pages: number; downloadMs: number; ocrMs: number; translateMs: number }
}

// Painel: quanto tempo cada etapa levou nos últimos capítulos preparados.
export function StageTimes() {
  const { t, locale } = useT()
  const [report, setReport] = useState<Report | null>(null)
  useEffect(() => { void fetch('/api/local/performance/stages', { cache: 'no-store' }).then((response) => response.json()).then(setReport).catch(() => setReport(null)) }, [])
  const seconds = (ms: number) => `${(ms / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} s`
  if (!report) return null
  if (!report.chapters.length) return <p className="koma-note">{t('O tempo de cada etapa aparece aqui quando os próximos capítulos ficarem prontos.')}</p>
  return <details className="koma-subdetails" data-stage-times>
    <summary>{t('Tempo das etapas nos últimos capítulos')}</summary>
    <div className="flex flex-col gap-3 pt-3">
      <p className="text-sm">{t('Média por página: baixar {download}, ler o texto {ocr}, traduzir {translate}.', { download: seconds(report.average.downloadMs), ocr: seconds(report.average.ocrMs), translate: seconds(report.average.translateMs) })}</p>
      <div className="koma-table-wrap"><table className="koma-table">
        <thead><tr><th>{t('Capítulo')}</th><th>{t('Páginas')}</th><th>{t('Baixar')}</th><th>{t('Ler o texto')}</th><th>{t('Traduzir')}</th></tr></thead>
        <tbody>{report.chapters.map((item) => <tr key={item.chapterId}>
          <td><strong>{item.work}</strong><p>{item.number ? t('Cap. {n}', { n: item.number }) : t('Especial')} · {new Date(item.at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}</p></td>
          <td>{item.pages}</td><td>{seconds(item.downloadMs)}</td><td>{seconds(item.ocrMs)}</td><td>{seconds(item.translateMs)}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="koma-note">{t('Ler o texto soma o tempo de cada página; com vários capítulos ao mesmo tempo, as etapas dividem o computador.')}</p>
    </div>
  </details>
}
