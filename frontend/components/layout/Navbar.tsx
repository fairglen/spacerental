'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useSession, signOut } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Building2, LogOut, User, Menu, X } from 'lucide-react'
import { useOrg } from '@/contexts/OrgContext'
import { useT } from '@/lib/i18n'
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher'

function OrgSwitcher({ className }: { className?: string }) {
  const t = useT()
  const { memberships, currentOrgId, setCurrentOrgId } = useOrg()
  if (memberships.length === 0) return null

  return (
    <div className={className}>
      <Select value={currentOrgId ?? undefined} onValueChange={setCurrentOrgId}>
        <SelectTrigger aria-label={t('navbar.org_selector_label')} className="h-9 min-w-[12rem]">
          <SelectValue placeholder={t('navbar.org_selector_placeholder')} />
        </SelectTrigger>
        <SelectContent>
          {memberships.map((m) => (
            <SelectItem key={m.org_id} value={m.org_id}>
              {m.org_name || 'Organização'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function Navbar() {
  const t = useT()
  const { data: session, status } = useSession()
  const { currentMembership } = useOrg()
  const [mobileOpen, setMobileOpen] = useState(false)
  const isSignedIn = status === 'authenticated'
  const navLinks = [
    { href: '/spaces', label: t('navbar.spaces_link') },
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
    <nav className="sticky top-0 z-50 w-full border-b border-border bg-white/90 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold text-foreground">EspaçoHora</span>
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
            {isSignedIn ? (
              <>
                <OrgSwitcher />
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
            {isSignedIn ? (
              <>
                <OrgSwitcher className="w-full" />
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
