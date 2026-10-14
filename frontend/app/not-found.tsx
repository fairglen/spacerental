import Link from 'next/link'
import { SearchX } from 'lucide-react'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Button } from '@/components/ui/button'
import { getServerLocale, tFor } from '@/lib/i18n/server'

export default function NotFound() {
  // A Server Component: the request's cookie, not the browser's store (B65).
  const t = tFor(getServerLocale())
  return (
    <>
      <Navbar />
      <main className="min-h-[60vh] bg-background flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <SearchX className="h-12 w-12 mx-auto mb-4 text-primary-light" />
          <h1 className="text-2xl font-bold text-foreground">{t('notFound.title')}</h1>
          <p className="mt-2 text-muted-foreground">{t('notFound.body')}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild><Link href="/">{t('notFound.home')}</Link></Button>
            <Button asChild variant="outline"><Link href="/spaces">{t('notFound.spaces')}</Link></Button>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
