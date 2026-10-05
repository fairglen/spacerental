import type { Metadata } from 'next'
import { ROBOTS_PRIVATE } from '@/lib/seo'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions, backendAcceptsToken } from '@/lib/auth'

export const metadata: Metadata = { title: 'As minhas reservas', robots: ROBOTS_PRIVATE }

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/sign-in')
  // A cookie that outlived its token (password changed elsewhere, account
  // suspended) does not get the page: straight to sign-in, with the reason.
  if (!(await backendAcceptsToken(session.accessToken))) redirect('/sign-in?session=expired')
  return <>{children}</>
}
