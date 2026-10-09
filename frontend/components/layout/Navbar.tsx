'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useSession, signOut } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { SpaceModeText } from '@/components/spaces/SpaceModeText'
import { LogOut, User, Menu, X, LifeBuoy } from 'lucide-react'
import { BrandMark } from '@/components/brand/BrandMark'
import { useHelp } from '@/components/help/HelpProvider'
import { useOrg } from '@/contexts/OrgContext'
import { useT } from '@/lib/i18n'
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher'

// Loaded only for a member of several organisations (P1.3): the select
// primitive it needs is 16 KB gzipped no public page should carry.
const OrgSwitcher = dynamic(() => import('@/components/layout/OrgSwitcher').then((m) => m.OrgSwitcher), { ssr: false })

export function Navbar() {
  const t = useT()
  const { data: session, status } = useSession()
  const { currentMembership, memberships } = useOrg()
  const canSwitchOrg = memberships.length >= 2
  const [mobileOpen, setMobileOpen] = useState(false)
  const { openHelp } = useHelp()
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
                <Link href="/dashboard/packages" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                  {t('navbar.my_packages')}
                </Link>
                <Link href="/dashboard">
                  <Button variant="outline" size="sm">{t('navbar.my_bookings')}</Button>
                </Link>
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => signOut({ callbackUrl: '/' })}
                    className="gap-1.5 text-muted-foreground"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    {t('navbar.sign_out')}
                  </Button>
                </div>
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

          {/* Mobile toggle */}
          <button
            className="md:hidden p-2 rounded-md text-muted-foreground hover:text-primary"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label={mobileOpen ? t('navbar.menu_close') : t('navbar.menu_open')}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-white px-4 pb-4 pt-2 space-y-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="block py-2 text-sm text-muted-foreground hover:text-primary transition-colors"
              onClick={() => setMobileOpen(false)}
            >
              {l.label}
            </Link>
          ))}
          <div className="pt-3 border-t border-border flex flex-col gap-2">
            <LocaleSwitcher className="self-start" />
            <Button variant="ghost" size="sm" onClick={() => { setMobileOpen(false); openHelp() }} className="w-full gap-1.5 text-muted-foreground">
              <LifeBuoy className="h-4 w-4" aria-hidden />
              {t('navbar.help')}
            </Button>
            {isSignedIn ? (
              <>
                {canSwitchOrg && <OrgSwitcher className="w-full" />}
                <Link
                  href="/dashboard/packages"
                  onClick={() => setMobileOpen(false)}
                  className="block py-2 text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  {t('navbar.my_packages')}
                </Link>
                <Link href="/dashboard" onClick={() => setMobileOpen(false)}>
                  <Button variant="outline" size="sm" className="w-full">{t('navbar.my_bookings')}</Button>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { signOut({ callbackUrl: '/' }); setMobileOpen(false) }}
                  className="w-full gap-1.5 text-muted-foreground"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  {t('navbar.sign_out')}
                </Button>
              </>
            ) : (
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
        </div>
      )}
    </nav>
  )
}
