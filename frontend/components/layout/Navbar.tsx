'use client'
import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { SpaceModeText } from '@/components/spaces/SpaceModeText'
import { Menu, X, LifeBuoy, CalendarDays, Package, Receipt } from 'lucide-react'
import { BrandMark } from '@/components/brand/BrandMark'
import { useHelp } from '@/components/help/HelpProvider'
import { useOrg } from '@/contexts/OrgContext'
import { useT } from '@/lib/i18n'
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher'
import { AccountMenu } from '@/components/layout/AccountMenu'

// Loaded only for a member of several organisations (P1.3): the select
// primitive it needs is 16 KB gzipped no public page should carry.
const OrgSwitcher = dynamic(() => import('@/components/layout/OrgSwitcher').then((m) => m.OrgSwitcher), { ssr: false })
// B69: the sheet's Dialog primitive arrives on the first tap, not with the page.
const MobileMenu = dynamic(() => import('@/components/layout/MobileMenu').then((m) => m.MobileMenu), { ssr: false })

const SHEET_LINK = 'block py-3 text-base text-foreground hover:text-primary transition-colors'

export function Navbar() {
  const t = useT()
  const { data: session, status } = useSession()
  const { currentMembership, memberships } = useOrg()
  const canSwitchOrg = memberships.length >= 2
  const [mobileOpen, setMobileOpen] = useState(false)
  const { openHelp } = useHelp()
  const pathname = usePathname()
  const isSignedIn = status === 'authenticated'
  const navLinks = [
    { href: '/spaces', label: <SpaceModeText single="navbar.rooms_link" multi="navbar.spaces_link" /> },
    { href: '/#como-funciona', label: t('navbar.how_it_works_link') },
    { href: '/#precos', label: t('navbar.pricing_link') },
  ]
  const isAdminInCurrentOrg =
    currentMembership?.role === 'admin' || currentMembership?.role === 'owner'
  // Fall back to the legacy session-level role for the nav link visibility when
  // memberships haven't loaded yet, so an admin-on-some-org still sees the link.
  const hasAnyAdminRole =
    session?.role === 'admin' || session?.role === 'owner' || isAdminInCurrentOrg

  const links = hasAnyAdminRole ? [...navLinks, { href: '/admin', label: t('navbar.admin_link') }] : navLinks
  // B69: the three account entries, the same in the sheet and in the menu.
  const accountLinks = [
    { href: '/dashboard', label: t('navbar.account_bookings'), icon: CalendarDays },
    { href: '/dashboard/packages', label: t('navbar.account_packs'), icon: Package },
    { href: '/dashboard/billing', label: t('navbar.billing'), icon: Receipt },
  ]
  const userName = session?.user?.name
  const userEmail = session?.user?.email

  // The sheet closes with the page it opened on (B69).
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border bg-white/90 backdrop-blur-xs">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center text-primary" aria-label={t('brand.name')}>
            {/* B58: the mark alone, 40px tall (44 wide at its ratio) — over the
                36px floor of B51 — at every width; the hamburger stays to its
                right under md. The static site's `.brand-mark`. */}
            <BrandMark width={44} />
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-6">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="text-sm text-muted-foreground hover:text-primary transition-colors">
                {l.label}
              </Link>
            ))}
          </div>

          {/* Desktop auth */}
          <div className="hidden md:flex items-center gap-3">
            <LocaleSwitcher />
            {/* Signed in or out: whoever cannot sign in needs it most (C17). */}
            <Button variant="ghost" size="sm" onClick={() => openHelp()} className="gap-1.5 text-muted-foreground">
              <LifeBuoy className="h-4 w-4" aria-hidden />
              {t('navbar.help')}
            </Button>
            {isSignedIn ? (
              <>
                {canSwitchOrg && <OrgSwitcher />}
                {/* B69: the signed-in links live behind the avatar. */}
                <AccountMenu
                  label={t('navbar.account_menu')}
                  name={userName}
                  email={userEmail}
                  links={accountLinks}
                  signOutLabel={t('navbar.sign_out')}
                  onSignOut={() => signOut({ callbackUrl: '/' })}
                />
              </>
            ) : (
              <>
                <Link href="/sign-in">
                  <Button variant="ghost" size="sm">{t('navbar.sign_in')}</Button>
                </Link>
                <Link href="/sign-up">
                  <Button size="sm">{t('navbar.book')}</Button>
                </Link>
              </>
            )}
          </div>

          {/* Mobile: a sheet below the bar (B69) — its own scroll, the page's
              locked, Escape and a route change close it, focus stays inside. */}
          <button
            type="button"
            className="md:hidden p-2 rounded-md text-muted-foreground hover:text-primary"
            aria-label={mobileOpen ? t('navbar.menu_close') : t('navbar.menu_open')}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
          {mobileOpen && (
            <MobileMenu open onOpenChange={setMobileOpen} title={t('navbar.menu')}>
              {isSignedIn && (
                <section aria-label={t('navbar.account_menu')} className="border-b border-border pb-3 mb-2">
                  <p className="px-0 py-2 text-xs text-muted-foreground">
                    {userName && <span className="block text-sm font-medium text-foreground">{userName}</span>}
                    {userEmail && <span className="block break-all">{userEmail}</span>}
                  </p>
                  {canSwitchOrg && <OrgSwitcher className="w-full my-2" />}
                  {accountLinks.map((l) => (
                    <Link key={l.href} href={l.href} className={SHEET_LINK} onClick={() => setMobileOpen(false)}>
                      {l.label}
                    </Link>
                  ))}
                  <button
                    type="button"
                    className={`${SHEET_LINK} w-full text-left`}
                    onClick={() => { setMobileOpen(false); signOut({ callbackUrl: '/' }) }}
                  >
                    {t('navbar.sign_out')}
                  </button>
                </section>
              )}
              {links.map((l) => (
                <Link key={l.href} href={l.href} className={SHEET_LINK} onClick={() => setMobileOpen(false)}>
                  {l.label}
                </Link>
              ))}
              <div className="pt-3 mt-2 border-t border-border flex flex-col gap-2">
                <LocaleSwitcher className="self-start" />
                <Button variant="ghost" size="sm" onClick={() => { setMobileOpen(false); openHelp() }} className="w-full gap-1.5 text-muted-foreground justify-start">
                  <LifeBuoy className="h-4 w-4" aria-hidden />
                  {t('navbar.help')}
                </Button>
                {!isSignedIn && (
                  <>
                    <Link href="/sign-in" onClick={() => setMobileOpen(false)}>
                      <Button variant="ghost" size="sm" className="w-full">{t('navbar.sign_in')}</Button>
                    </Link>
                    <Link href="/sign-up" onClick={() => setMobileOpen(false)}>
                      <Button size="sm" className="w-full">{t('navbar.book')}</Button>
                    </Link>
                  </>
                )}
              </div>
            </MobileMenu>
          )}
        </div>
      </div>
    </nav>
  )
}
