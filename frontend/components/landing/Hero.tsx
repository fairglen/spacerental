'use client'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { SpaceModeText } from '@/components/spaces/SpaceModeText'
import { BrandMark } from '@/components/brand/BrandMark'

export function Hero() {
  const t = useT()
  return (
    <section className="relative overflow-hidden bg-linear-to-br from-white via-accent to-primary-light/30 py-20 md:py-32">
      {/* B51/B60: under 1024px the mark is a watermark centred on the hero,
          behind the words, buttons and benefits (the content box below is
          `relative`, so it paints above). The static site's `.hero-watermark`. */}
      <BrandMark
        width={440}
        className="lg:hidden absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(440px,90vw)] h-auto text-primary opacity-(--hero-watermark-opacity) pointer-events-none"
      />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* B51: from 1024px, two columns — the text at its 48rem, the mark centred
            in whatever is left (closer at 1440, further at 1920 — intended). The
            static site's `.hero-grid`. */}
        <div className="lg:grid lg:grid-cols-[minmax(0,48rem)_1fr] lg:gap-8 lg:items-center">
        <div className="max-w-3xl">
          {/* The same fade-up the hero always had, as a CSS animation
              (tailwindcss-animate) — P1.3 dropped framer-motion, 34 KB of
              gzipped JavaScript on every landing load, for this one effect. */}
          <div className="animate-in fade-in slide-in-from-bottom-5 duration-700 fill-mode-both motion-reduce:animate-none">
            {/* B59: the brand word above the headline — a name, not copy, so
                it is not in the catalogs and not part of the h1. The static
                site's `.hero-brand`. */}
            <p className="hero-brand text-4xl md:text-5xl font-extrabold tracking-tight text-foreground whitespace-nowrap mb-3">
              Flow<span className="text-primary">Space</span>
            </p>
            {/* md:leading-none keeps what Tailwind 3 rendered: its responsive
                md:text-6xl came after .leading-tight in the stylesheet and reset
                the line-height to 1 from md up; v4 lets leading-tight win. */}
            <h1 className="text-5xl md:text-6xl font-bold text-foreground leading-tight md:leading-none mb-6">
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
          </div>
        </div>
        {/* B51: the mark as the illustration over a soft disc (a `before:` pseudo
            that takes no layout and no pointer). The static site's `.hero-mark`. */}
        <div
          aria-hidden="true"
          data-testid="hero-mark"
          className="hidden lg:flex relative min-h-[420px] items-center justify-center text-primary before:content-[''] before:absolute before:left-1/2 before:top-1/2 before:h-[460px] before:w-[460px] before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:bg-[radial-gradient(circle_at_30%_30%,rgba(168,213,186,.55),rgba(232,244,240,0)_70%)] before:pointer-events-none"
        >
          <BrandMark width={400} className="relative w-[min(100%,400px)] h-auto" />
        </div>
        </div>
      </div>
      <div className="absolute right-0 top-0 h-[600px] w-[600px] rounded-full bg-primary-light/20 blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
    </section>
  )
}
