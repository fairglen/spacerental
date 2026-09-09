'use client'
import Link from 'next/link'
import { Building2, MapPin, Mail } from 'lucide-react'
import { useT } from '@/lib/i18n'

export function Footer() {
  const t = useT()
  return (
    <footer className="bg-foreground text-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Building2 className="h-5 w-5 text-primary-light" />
              <span className="text-lg font-bold">EspaçoHora</span>
            </div>
            <p className="text-sm text-gray-400 max-w-xs">
              {t('footer.tagline')}
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-4 text-primary-light">{t('footer.links_heading')}</h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li>
                <Link href="/spaces" className="hover:text-white transition-colors">
                  {t('footer.spaces')}
                </Link>
              </li>
              <li>
                <Link href="/#como-funciona" className="hover:text-white transition-colors">
                  {t('footer.how_it_works')}
                </Link>
              </li>
              <li>
                <Link href="/#precos" className="hover:text-white transition-colors">
                  {t('footer.pricing')}
                </Link>
              </li>
              <li>
                <Link href="/sign-in" className="hover:text-white transition-colors">
                  {t('footer.sign_in')}
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold mb-4 text-primary-light">{t('footer.contact_heading')}</h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li className="flex items-center gap-2">
                <MapPin className="h-4 w-4" /> {t('footer.location')}
              </li>
              <li className="flex items-center gap-2">
                <Mail className="h-4 w-4" /> {t('footer.email')}
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-8 pt-8 border-t border-gray-700 text-center text-sm text-gray-500">
          {t('footer.copyright', { year: new Date().getFullYear() })}
        </div>
      </div>
    </footer>
  )
}
