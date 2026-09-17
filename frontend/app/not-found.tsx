import Link from 'next/link'
import { SearchX } from 'lucide-react'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <>
      <Navbar />
      <main className="min-h-[60vh] bg-background flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <SearchX className="h-12 w-12 mx-auto mb-4 text-primary-light" />
          <h1 className="text-2xl font-bold text-foreground">Página não encontrada</h1>
          <p className="mt-2 text-muted-foreground">
            A página que procuras não existe ou foi movida.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild><Link href="/">Voltar ao início</Link></Button>
            <Button asChild variant="outline"><Link href="/spaces">Ver espaços</Link></Button>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
