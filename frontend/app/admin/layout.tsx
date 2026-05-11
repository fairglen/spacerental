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
  const { data: session, status } = useSession()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/sign-in')
  }, [status, router])

  if (status === 'loading') return null

  return (
    <div className="flex min-h-screen bg-[#F9FAFB]">
      <aside className="w-56 bg-white border-r border-[#E5E7EB] flex flex-col">
        <div className="p-4 border-b border-[#E5E7EB]">
          <Link href="/" className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-[#3D7A5E]" />
            <span className="font-bold text-[#1A1A2E] text-sm">EspaçoHora</span>
          </Link>
          <p className="text-xs text-[#6B7280] mt-1">Painel de Admin</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                pathname === item.href
                  ? 'bg-[#E8F4F0] text-[#3D7A5E] font-medium'
                  : 'text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#1A1A2E]'
              )}>
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-[#E5E7EB]">
          <Link href="/" className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-[#6B7280] hover:text-[#1A1A2E]">
            <LogOut className="h-4 w-4" /> Voltar ao Site
          </Link>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
