import Link from 'next/link'
import { Building2, MapPin, Mail } from 'lucide-react'

export function Footer() {
  return (
    <footer className="bg-[#1A1A2E] text-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Building2 className="h-5 w-5 text-[#A8D5BA]" />
              <span className="text-lg font-bold">EspaçoHora</span>
            </div>
            <p className="text-sm text-gray-400 max-w-xs">
              Espaços profissionais por hora para psicólogos, terapeutas e outros profissionais de
              saúde.
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-4 text-[#A8D5BA]">Links</h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li>
                <Link href="/spaces" className="hover:text-white transition-colors">
                  Espaços
                </Link>
              </li>
              <li>
                <Link href="/#como-funciona" className="hover:text-white transition-colors">
                  Como Funciona
                </Link>
              </li>
              <li>
                <Link href="/#precos" className="hover:text-white transition-colors">
                  Preços
                </Link>
              </li>
              <li>
                <Link href="/sign-in" className="hover:text-white transition-colors">
                  Entrar
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold mb-4 text-[#A8D5BA]">Contacto</h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li className="flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Lisboa, Portugal
              </li>
              <li className="flex items-center gap-2">
                <Mail className="h-4 w-4" /> geral@espacohora.pt
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-8 pt-8 border-t border-gray-700 text-center text-sm text-gray-500">
          © {new Date().getFullYear()} EspaçoHora. Todos os direitos reservados.
        </div>
      </div>
    </footer>
  )
}
