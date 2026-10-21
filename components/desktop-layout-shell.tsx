'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { BookOpen, Info, Layers3, Plus, Settings2 } from 'lucide-react'
import { InkBackground } from '@/components/ink-background'
import { useT } from '@/components/i18n'

const navigation = [
  { href: '/inicio/secoes', label: 'Biblioteca', icon: BookOpen, match: (path: string) => /^\/inicio\/(secoes|importados|fontes)|^\/inicio\/obras\/\d/.test(path) },
  { href: '/inicio/obras/nova', label: 'Adicionar', icon: Plus, match: (path: string) => path.startsWith('/inicio/obras/nova'), add: true },
  { href: '/inicio/fila-global', label: 'Processa\u00admento', icon: Layers3, match: (path: string) => path.startsWith('/inicio/fila-global') },
  { href: '/inicio/preferencias', label: 'Preferên\u00adcias', icon: Settings2, match: (path: string) => path.startsWith('/inicio/preferencias') },
]

// Leitura (obra ou importação avulsa) fica em tela cheia, sem trilho nem fundo vivo.
export function isReadingPath(path: string) {
  return /^\/inicio\/obras\/\d+\/ler\//.test(path) || /^\/inicio\/secoes\/\d+/.test(path)
}

export function DesktopLayoutShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const reading = isReadingPath(pathname)
  const { t } = useT()
  return (
    <div className={`koma-desktop ${reading ? 'is-reading' : ''}`}>
      <a href="#koma-content" className="koma-skip-link">{t('Ir para o conteúdo')}</a>
      {reading ? null : <>
        <InkBackground />
        <aside className="koma-rail" aria-label={t('Navegação principal')}>
          <Link href="/inicio/secoes" className="koma-wordmark" aria-label={t('KOMA, minha biblioteca')}>KOMA<span aria-hidden="true"><b>コ</b><b>マ</b></span></Link>
          <nav>{navigation.map(({ href, label, icon: Icon, match, add }) => {
            const active = match(pathname)
            return <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={add ? 'is-add' : undefined}>
              <Icon size={22} aria-hidden="true" /><span>{t(label)}</span>
            </Link>
          })}</nav>
          <div className="koma-rail-bottom">
            <span className="koma-local-dot">{t('Neste computador')}</span>
            <Link href="/inicio/sobre" aria-current={pathname.startsWith('/inicio/sobre') ? 'page' : undefined}><Info size={20} aria-hidden="true" /><span>{t('Sobre')}</span></Link>
          </div>
        </aside>
      </>}
      <div className="koma-main-column">
        <main id="koma-content" className="koma-content"><div key={pathname} className={reading ? undefined : 'koma-page-enter'}>{children}</div></main>
      </div>
    </div>
  )
}
