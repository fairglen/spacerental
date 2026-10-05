import type { Metadata } from 'next'
import { ROBOTS_PRIVATE } from '@/lib/seo'

export const metadata: Metadata = { title: 'Entrar', robots: ROBOTS_PRIVATE }

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
