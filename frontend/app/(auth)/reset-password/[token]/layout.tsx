import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Nova password' }

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
