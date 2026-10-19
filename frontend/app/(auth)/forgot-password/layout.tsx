import type { Metadata } from 'next'
import { getServerLocale, tFor } from '@/lib/i18n/server'

// B65: the tab title follows the locale cookie, like the page.
export function generateMetadata(): Metadata {
  return { title: tFor(getServerLocale())('auth.forgot_page_title') }
}

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
