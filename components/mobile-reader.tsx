'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { WorkChapter, WorkSummary } from '@/lib/works'
import { useT } from '@/components/i18n'

// Telas do celular ("Ler no celular"): biblioteca, capítulos prontos e leitor.
// Só leitura: nada de Preferências, chaves ou fila.
const shell = 'mx-auto flex min-h-screen w-full max-w-xl flex-col gap-3 bg-[#f3eee6] px-3 py-4 text-[#141414]'
function useData<T>(url: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    setError(false)
    void fetch(url, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error()
        setData(await response.json())
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true)
      })
    return () => controller.abort()
  }, [url])
  return { data, error }
}
const chapterLabel = (t: ReturnType<typeof useT>['t'], number: string | null) => (number ? t('Cap. {n}', { n: number }) : t('Especial'))

export function MobileLibrary() {
  const { t } = useT()
  const { data, error } = useData<{ works: WorkSummary[] }>('/api/local/works')
  return (
    <main className={shell} data-mobile="library">
      <h1 className="text-2xl font-black">KOMA</h1>
      {error ? <p>{t('Não foi possível abrir a biblioteca.')}</p> : !data ? <p>{t('Abrindo…')}</p> : null}
      <ul className="flex flex-col gap-3">
        {data?.works
          .filter((work) => work.readyChapters > 0)
          .map((work) => (
            <li key={work.id} className="flex gap-3 border-2 border-[#141414] bg-[#fbf8f3] p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {work.coverUrl ? (
                <img src={work.coverUrl} alt="" width={64} height={90} className="h-[90px] w-16 flex-shrink-0 object-cover" />
              ) : (
                <span className="h-[90px] w-16 flex-shrink-0 bg-[#e8e1d6]" />
              )}
              <div className="flex min-w-0 flex-col gap-1">
                <Link href={`/movel/obra/${work.id}`} className="font-bold leading-tight">
                  {work.title}
                </Link>
                <span className="text-sm">
                  {t('{ready} de {total} capítulos prontos', { ready: work.readyChapters, total: work.totalChapters })}
                </span>
                {work.nextChapter ? (
                  <Link
                    href={`/movel/ler/${work.id}/${work.nextChapter.id}`}
                    className="self-start bg-[#c62a43] px-3 py-1 text-sm font-bold text-white"
                  >
                    {t('Continuar: {chapter}', { chapter: chapterLabel(t, work.nextChapter.number) })}
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
      </ul>
    </main>
  )
}

export function MobileWork({ workId }: { workId: number }) {
  const { t } = useT()
  const { data, error } = useData<{ work: WorkSummary; chapters: WorkChapter[] }>(`/api/local/works/${workId}`)
  return (
    <main className={shell} data-mobile="work">
      <Link href="/movel" className="text-sm underline">
        ← {t('Biblioteca')}
      </Link>
      <h1 className="text-xl font-black">{data?.work.title || ''}</h1>
      {error ? <p>{t('Não foi possível abrir a obra.')}</p> : !data ? <p>{t('Abrindo…')}</p> : null}
      <ul className="grid grid-cols-3 gap-2">
        {data?.chapters
          .filter((chapter) => ['ready', 'partial'].includes(chapter.state))
          .map((chapter) => (
            <li key={chapter.id}>
              <Link
                href={`/movel/ler/${workId}/${chapter.id}`}
                className={`block border-2 border-[#141414] p-2 text-center text-sm font-bold ${chapter.read ? 'bg-[#e8e1d6] text-[#4a4845]' : 'bg-[#fbf8f3]'}`}
              >
                {chapterLabel(t, chapter.number)}
              </Link>
            </li>
          ))}
      </ul>
    </main>
  )
}

interface Reading {
  work: WorkSummary
  chapter: WorkChapter
  nextChapterId: number | null
  previousChapterId: number | null
  pages: Array<{ id: number; width: number; height: number; originalUrl: string; translatedUrl?: string | null }>
}
export function MobileReader({ workId, chapterId }: { workId: number; chapterId: number }) {
  const { t } = useT()
  const { data, error } = useData<Reading>(`/api/local/works/${workId}/chapters/${chapterId}`)
  const end = useRef<HTMLDivElement | null>(null)
  const marked = useRef(false)
  // Chegou ao fim do capítulo: marca como lido (o único pedido que muda algo).
  useEffect(() => {
    marked.current = false
    const target = end.current
    if (!target || !data) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || marked.current) return
      marked.current = true
      void fetch(`/api/local/works/${workId}/chapters/${chapterId}`, { method: 'POST' }).catch(() => {
        marked.current = false
      })
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [data, workId, chapterId])
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col bg-black text-white" data-mobile="reader">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-black/90 px-3 py-2 text-sm">
        <Link href={`/movel/obra/${workId}`} className="underline">
          ← {data?.work.title || t('Capítulos')}
        </Link>
        <span className="font-bold">{data ? chapterLabel(t, data.chapter.number) : ''}</span>
      </header>
      {error ? <p className="p-4">{t('Não foi possível abrir o capítulo.')}</p> : !data ? <p className="p-4">{t('Abrindo…')}</p> : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {data?.pages.map((page, index) => (
        <img
          key={page.id}
          src={page.translatedUrl || page.originalUrl}
          alt={t('Página {n}', { n: index + 1 })}
          width={page.width}
          height={page.height}
          loading={index < 2 ? 'eager' : 'lazy'}
          className="block h-auto w-full"
        />
      ))}
      <div ref={end} className="flex flex-col gap-3 p-4">
        {data?.nextChapterId ? (
          <Link href={`/movel/ler/${workId}/${data.nextChapterId}`} className="bg-[#c62a43] px-4 py-3 text-center font-bold">
            {t('Próximo capítulo')}
          </Link>
        ) : null}
        <Link href={`/movel/obra/${workId}`} className="border border-white px-4 py-3 text-center">
          {t('Voltar aos capítulos')}
        </Link>
      </div>
    </main>
  )
}
