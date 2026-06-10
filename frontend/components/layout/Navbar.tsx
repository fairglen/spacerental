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

const navLinks = [
  { href: '/spaces', label: 'Espaços' },
  { href: '/#como-funciona', label: 'Como Funciona' },
  { href: '/#precos', label: 'Preços' },
]

function OrgSwitcher({ className }: { className?: string }) {
  const { memberships, currentOrgId, setCurrentOrgId } = useOrg()
  if (memberships.length === 0) return null

  return (
    <div className={className}>
      <Select value={currentOrgId ?? undefined} onValueChange={setCurrentOrgId}>
        <SelectTrigger aria-label="Organização ativa" className="h-9 min-w-[12rem]">
          <SelectValue placeholder="Selecionar organização" />
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
  const { data: session, status } = useSession()
  const { currentMembership } = useOrg()
  const [mobileOpen, setMobileOpen] = useState(false)
  const isSignedIn = status === 'authenticated'
  const isAdminInCurrentOrg =
    currentMembership?.role === 'admin' || currentMembership?.role === 'owner'
  // Fall back to the legacy session-level role for the nav link visibility when
  // memberships haven't loaded yet, so an admin-on-some-org still sees the link.
  const hasAnyAdminRole =
    session?.role === 'admin' || session?.role === 'owner' || isAdminInCurrentOrg

  const links = hasAnyAdminRole ? [...navLinks, { href: '/admin', label: 'Admin' }] : navLinks

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
            {isSignedIn ? (
              <>
                <OrgSwitcher />
                <Link href="/dashboard">
                  <Button variant="outline" size="sm">As minhas reservas</Button>
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
                    Sair
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Link href="/sign-in">
                  <Button variant="ghost" size="sm">Entrar</Button>
                </Link>
                <Link href="/sign-up">
                  <Button size="sm">Reservar</Button>
                </Link>
              </>
            )}
          </div>

          {/* Mobile toggle */}
          <button
            className="md:hidden p-2 rounded-md text-muted-foreground hover:text-primary"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label={mobileOpen ? 'Fechar menu' : 'Abrir menu'}
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
            {isSignedIn ? (
              <>
                <OrgSwitcher className="w-full" />
                <Link href="/dashboard" onClick={() => setMobileOpen(false)}>
                  <Button variant="outline" size="sm" className="w-full">As minhas reservas</Button>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { signOut({ callbackUrl: '/' }); setMobileOpen(false) }}
                  className="w-full gap-1.5 text-muted-foreground"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sair
                </Button>
              </>
            ) : (
              <>
                <Link href="/sign-in" onClick={() => setMobileOpen(false)}>
                  <Button variant="ghost" size="sm" className="w-full">Entrar</Button>
                </Link>
                <Link href="/sign-up" onClick={() => setMobileOpen(false)}>
                  <Button size="sm" className="w-full">Reservar</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
