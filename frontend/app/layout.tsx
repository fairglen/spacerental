import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { Providers } from './providers'
import pt from '@/lib/i18n/pt.json'
import { ROBOTS_APP, metadataBaseFrom } from '@/lib/seo'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

// Metadata is rendered on the server before any locale choice exists, so it
// reads the Portuguese catalog directly: one source for the brand line.
const BRAND_LINE = `${pt.brand.name} · ${pt.brand.tagline}`
const DESCRIPTION =
  'Gabinetes profissionais para profissionais de saúde e bem-estar, disponíveis à hora. Reserve online, sem contratos longos.'

// B50: the brand set under /brand (a copy of the static site's; see
// tests/lib/brandParity.test.ts) — favicons, the Open Graph card, a manifest.
export const metadata: Metadata = {
  // The app's public URL (FRONTEND_URL, else NEXTAUTH_URL) makes the Open
  // Graph image absolute; unset — a bare `next build` — Next falls back to
  // localhost and says so.
  metadataBase: metadataBaseFrom(process.env),
  // S2.1: the app is not an indexable surface — flowspace.pt is.
  robots: ROBOTS_APP,
  title: { default: BRAND_LINE, template: `%s · ${pt.brand.name}` },
  description: DESCRIPTION,
  icons: {
    icon: [
      { url: '/brand/favicon.svg', type: 'image/svg+xml' },
      { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/brand/apple-touch-icon.png',
  },
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: BRAND_LINE,
    description: DESCRIPTION,
    siteName: pt.brand.name,
    locale: 'pt_PT',
    type: 'website',
    images: [{ url: '/brand/og-image.png', width: 1200, height: 630, alt: pt.brand.name }],
  },
}

export const viewport: Viewport = { themeColor: '#3D7A5E' }

// P1.2: the origin the browser's API calls go to, when it is not this site's
// own — the first fetch then skips DNS, TCP and TLS. Both values are fixed at
// build time (NEXT_PUBLIC_API_URL is inlined; NEXTAUTH_URL is Compose's).
const API_ORIGIN = new URL(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1').origin
const SITE_ORIGIN = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : null

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-PT">
      {API_ORIGIN !== SITE_ORIGIN && (
        <head>
          <link rel="preconnect" href={API_ORIGIN} />
        </head>
      )}
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
