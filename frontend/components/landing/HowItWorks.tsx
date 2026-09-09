import { t } from '@/lib/i18n'

const steps = [
  { n: '01', title: t('howItWorks.step_1_title'), desc: t('howItWorks.step_1_desc') },
  { n: '02', title: t('howItWorks.step_2_title'), desc: t('howItWorks.step_2_desc') },
  { n: '03', title: t('howItWorks.step_3_title'), desc: t('howItWorks.step_3_desc') },
  { n: '04', title: t('howItWorks.step_4_title'), desc: t('howItWorks.step_4_desc') },
]

export function HowItWorks() {
  return (
    <section id="como-funciona" className="py-20 bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-4">{t('howItWorks.section_title')}</h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            {t('howItWorks.section_description')}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {steps.map((step, i) => (
            <div key={step.n} className="relative flex flex-col items-center text-center">
              {i < steps.length - 1 && (
                <div className="hidden lg:block absolute top-6 left-1/2 w-full h-px bg-border" />
              )}
              <div className="relative z-10 mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-lg">
                {step.n}
              </div>
              <h3 className="font-semibold text-foreground mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
