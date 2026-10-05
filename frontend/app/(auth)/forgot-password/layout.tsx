import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Recuperar password' }

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
