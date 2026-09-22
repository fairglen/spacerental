'use client'
import { useT } from '@/lib/i18n'

/** The owner's "O espaço" text (W03): two paragraphs, same framing as the other sections. */
export function TheSpace() {
  const t = useT()
  return (
    <section id="o-espaco" className="py-20 bg-white scroll-mt-16" aria-labelledby="o-espaco-titulo">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h2 id="o-espaco-titulo" className="text-3xl font-bold text-foreground">{t('theSpace.title')}</h2>
        </div>
        <div className="mx-auto max-w-3xl space-y-5 text-center text-lg text-muted-foreground">
          <p>{t('theSpace.p1')}</p>
          <p>{t('theSpace.p2')}</p>
        </div>
      </div>
    </section>
  )
}
