import type { Metadata } from 'next'
import { Toaster } from '@/components/ui/sonner'
import { I18nProvider } from '@/components/i18n'
import { uiLanguage } from '@/lib/i18n/server'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'KOMA | Biblioteca pessoal e tradução de mangás', template: '%s | KOMA' },
  description:
    'KOMA, projeto de Jean Vitor: biblioteca pessoal de mangás, manhwas e manhuas, com coleta de capítulos e preparação da leitura em português brasileiro.',
  applicationName: 'KOMA',
  authors: [{ name: 'Jean Vitor', url: 'https://www.linkedin.com/in/jean-vitor-16a19642a/' }],
  creator: 'Jean Vitor',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const lang = await uiLanguage()
  return (
    <html lang={lang}>
      <body className="font-sans antialiased">
        <I18nProvider lang={lang}>{children}</I18nProvider>
        <Toaster position="bottom-center" richColors />
      </body>
    </html>
  )
}
