import type { ReactNode } from 'react'
import { requireUser } from '@/app/api/_shared/proxy'
import { DesktopLayoutShell } from '@/components/desktop-layout-shell'
import { serverT } from '@/lib/i18n/server'

export default async function InicioLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  const user = await requireUser()

  // A sessão local é criada pelo aplicativo KOMA ao abrir a janela.
  if (!user) {
    const t = await serverT()
    return (
      <main className="grid min-h-screen place-items-center p-6 text-center">
        {t('Abra o KOMA pelo aplicativo para acessar sua biblioteca.')}
      </main>
    )
  }

  return <DesktopLayoutShell>{children}</DesktopLayoutShell>
}
