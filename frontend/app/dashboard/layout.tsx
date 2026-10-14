import type { Metadata } from 'next'
import { ROBOTS_PRIVATE } from '@/lib/seo'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions, backendAcceptsToken } from '@/lib/auth'
import pt from '@/lib/i18n/pt.json'

// Static, like every route's metadata (tests/app/robotsMetadata.test.ts
// reads the export): the tab title stays the Portuguese catalog's (B65).
export const metadata: Metadata = { title: pt.navbar.my_bookings, robots: ROBOTS_PRIVATE }

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/sign-in')
  // A cookie that outlived its token (password changed elsewhere, account
  // suspended) does not get the page: straight to sign-in, with the reason.
  if (!(await backendAcceptsToken(session.accessToken))) redirect('/sign-in?session=expired')
  return <>{children}</>
}
