import type { Metadata } from 'next'
import { ROBOTS_PRIVATE } from '@/lib/seo'
import { AdminShell } from '@/components/admin/AdminShell'

export const metadata: Metadata = { title: 'Painel de Admin', robots: ROBOTS_PRIVATE }

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>
}
