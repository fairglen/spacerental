'use client'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { ArrowRight, Clock } from 'lucide-react'

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-white via-accent to-primary-light/30 py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-sm text-primary">
              <Clock className="h-3.5 w-3.5" />
              <span>Disponível à hora, por pacote ou recorrente</span>
            </div>
            <h1 className="text-5xl md:text-6xl font-bold text-foreground leading-tight mb-6">
              O teu espaço,{' '}
              <span className="text-primary italic">no teu tempo</span>
            </h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-xl">
              Salas privadas para psicólogos, terapeutas e profissionais de saúde. Reserva online em
              segundos, sem contratos longos.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/spaces">
                <Button size="lg" className="gap-2">
                  Ver Espaços <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/#como-funciona">
                <Button size="lg" variant="outline">
                  Saber Mais
                </Button>
              </Link>
            </div>
            <div className="mt-10 flex items-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-primary" /> Sem caução
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-primary" /> Cancelamento gratuito 24h
                antes
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-primary" /> Pagamento seguro
              </div>
            </div>
          </motion.div>
        </div>
      </div>
      <div className="absolute right-0 top-0 h-[600px] w-[600px] rounded-full bg-primary-light/20 blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
    </section>
  )
}
