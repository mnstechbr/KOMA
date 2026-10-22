import Image from 'next/image'
import type { WorkSummary } from '@/lib/works'
import { format } from '@/lib/i18n/core'

// Peças visuais compartilhadas pelas telas da direção Tinta. Sem hooks: quem
// chama passa o t() de useT(); sem ele, o texto fica em português.
export type Translate = (text: string, vars?: Record<string, string | number>) => string
const portuguese: Translate = (text, vars) => format(text, vars)

export function workKind(work: WorkSummary, t: Translate = portuguese) {
  const language = work.metadata.originalLanguage || ''
  return language === 'ja' ? t('MANGÁ') : language === 'ko' ? 'MANHWA' : language.startsWith('zh') ? 'MANHUA' : t('QUADRINHOS')
}

export function chapterLabel(chapter: { number: string | null }, t: Translate = portuguese) {
  return chapter.number ? t('Cap. {n}', { n: chapter.number }) : t('Especial')
}

export function WorkCover({
  work,
  sizes,
  t = portuguese,
}: {
  work: Pick<WorkSummary, 'title' | 'coverUrl'>
  sizes: string
  t?: Translate
}) {
  return work.coverUrl ? (
    <Image src={work.coverUrl} alt={t('Capa de {title}', { title: work.title })} fill sizes={sizes} unoptimized />
  ) : (
    <span className="koma-cover-placeholder" aria-hidden="true">
      コマ
    </span>
  )
}

export function BrushProgress({ value, max, label, red = false }: { value: number; max: number; label: string; red?: boolean }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  return (
    <div
      className={`koma-brush ${red ? 'is-red' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <span style={{ transform: `scaleX(${ratio})` }} />
    </div>
  )
}
