import type { Metadata } from 'next'
import { ROBOTS_PRIVATE } from '@/lib/seo'

export const metadata: Metadata = { title: 'Nova password', robots: ROBOTS_PRIVATE }

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
