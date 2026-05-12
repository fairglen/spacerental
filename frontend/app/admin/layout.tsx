'use client'
import { useSession } from 'next-auth/react'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect } from 'react'
import Link from 'next/link'
import { LayoutDashboard, Building2, Calendar, Package, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/spaces', label: 'Espaços', icon: Building2 },
  { href: '/admin/bookings', label: 'Reservas', icon: Calendar },
  { href: '/admin/packages', label: 'Pacotes', icon: Package },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/sign-in')
  }, [status, router])

  if (status === 'loading') return null

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="w-56 bg-white border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <Link href="/" className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <span className="font-bold text-foreground text-sm">EspaçoHora</span>
          </Link>
          <p className="text-xs text-muted-foreground mt-1">Painel de Admin</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                pathname === item.href
                  ? 'bg-accent text-primary font-medium'
                  : 'text-muted-foreground hover:bg-background hover:text-foreground'
              )}>
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <Link href="/" className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground">
            <LogOut className="h-4 w-4" /> Voltar ao Site
          </Link>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
