'use client'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { SpaceModeText } from '@/components/spaces/SpaceModeText'

export function Hero() {
  const t = useT()
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-white via-accent to-primary-light/30 py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-5xl md:text-6xl font-bold text-foreground leading-tight mb-6">
              {t('hero.headline_start')}{' '}
              <span className="text-primary italic">{t('hero.headline_highlight')}</span>
            </h1>
            <p className="text-xl text-muted-foreground mb-4 max-w-xl">
              {t('hero.description')}
            </p>
            <p className="text-lg text-muted-foreground mb-8 max-w-xl">
              {t('hero.support')}
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/spaces">
                <Button size="lg" className="gap-2">
                  <SpaceModeText single="hero.cta_primary_rooms" multi="hero.cta_primary" skeletonClassName="h-4 w-20 bg-white/40" />{' '}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/#como-funciona">
                <Button size="lg" variant="outline">
                  {t('hero.cta_secondary')}
                </Button>
              </Link>
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-primary" /> {t('hero.benefit_booking')}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-primary" /> {t('hero.benefit_1')}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-primary" /> {t('hero.benefit_2')}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-primary" /> {t('hero.benefit_3')}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
      <div className="absolute right-0 top-0 h-[600px] w-[600px] rounded-full bg-primary-light/20 blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
    </section>
  )
}
