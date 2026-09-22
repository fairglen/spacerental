import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Salas' }

export default function SpacesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
