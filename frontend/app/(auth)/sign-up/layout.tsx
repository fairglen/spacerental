import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Criar conta' }

export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
