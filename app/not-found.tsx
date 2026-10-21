'use client'
import Link from 'next/link'
import { useT } from '@/components/i18n'

export default function NotFound() {
  const { t } = useT()
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="koma-box max-w-md space-y-4 text-center">
        <p className="koma-section-title">404</p>
        <h1 className="text-xl font-bold">{t('Página não encontrada')}</h1>
        <p className="text-sm text-muted-foreground">{t('Esta página não existe no KOMA. Volte para a biblioteca e continue a leitura.')}</p>
        <Link href="/inicio/secoes" className="koma-button">{t('Ir para a biblioteca')}</Link>
      </div>
    </main>
  )
}
