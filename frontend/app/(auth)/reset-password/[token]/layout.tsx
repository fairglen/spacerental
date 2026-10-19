import type { Metadata } from 'next'
import { ROBOTS_PRIVATE } from '@/lib/seo'
import { getServerLocale, tFor } from '@/lib/i18n/server'

// B65: the tab title follows the locale cookie, like the page.
export function generateMetadata(): Metadata {
  return { title: tFor(getServerLocale())('auth.new_password_label'), robots: ROBOTS_PRIVATE }
}

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
