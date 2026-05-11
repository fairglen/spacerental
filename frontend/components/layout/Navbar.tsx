'use client'
import Link from 'next/link'
import { useSession, signOut } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Building2, LogOut, User } from 'lucide-react'

export function Navbar() {
  const { data: session, status } = useSession()
  const isSignedIn = status === 'authenticated'
  const isAdmin = session?.role === 'admin' || session?.role === 'owner'

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-[#E5E7EB] bg-white/90 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Building2 className="h-6 w-6 text-[#3D7A5E]" />
            <span className="text-xl font-bold text-[#1A1A2E]">EspaçoHora</span>
          </Link>
          <div className="hidden md:flex items-center gap-6">
            <Link href="/spaces" className="text-sm text-[#6B7280] hover:text-[#3D7A5E] transition-colors">Espaços</Link>
            <Link href="/#como-funciona" className="text-sm text-[#6B7280] hover:text-[#3D7A5E] transition-colors">Como Funciona</Link>
            <Link href="/#precos" className="text-sm text-[#6B7280] hover:text-[#3D7A5E] transition-colors">Preços</Link>
            {isAdmin && (
              <Link href="/admin" className="text-sm text-[#6B7280] hover:text-[#3D7A5E] transition-colors">Admin</Link>
            )}
          </div>
          <div className="flex items-center gap-3">
            {isSignedIn ? (
              <>
                <Link href="/dashboard">
                  <Button variant="outline" size="sm">As minhas reservas</Button>
                </Link>
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E8F4F0]">
                    <User className="h-4 w-4 text-[#3D7A5E]" />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => signOut({ callbackUrl: '/' })}
                    className="gap-1.5 text-[#6B7280]"
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
        </div>
      </div>
    </nav>
  )
}
