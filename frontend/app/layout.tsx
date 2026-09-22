import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Providers } from './providers'
import pt from '@/lib/i18n/pt.json'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

// Metadata is rendered on the server before any locale choice exists, so it
// reads the Portuguese catalog directly: one source for the brand line.
const BRAND_LINE = `${pt.brand.name} · ${pt.brand.tagline}`
const DESCRIPTION =
  'Gabinetes profissionais para profissionais de saúde e bem-estar, disponíveis à hora. Reserve online, sem contratos longos.'

export const metadata: Metadata = {
  title: { default: BRAND_LINE, template: `%s · ${pt.brand.name}` },
  description: DESCRIPTION,
  openGraph: { title: BRAND_LINE, description: DESCRIPTION, siteName: pt.brand.name, locale: 'pt_PT', type: 'website' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
