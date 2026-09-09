'use client'
import { cn } from '@/lib/utils'
import { SUPPORTED_LOCALES, LOCALE_LABELS, useLocale } from '@/lib/i18n'

export function LocaleSwitcher({ className }: { className?: string }) {
  const [locale, setLocale] = useLocale()

  return (
    <div
      role="group"
      aria-label="Language"
      className={cn(
        'inline-flex items-center rounded-lg border border-border bg-white p-0.5 text-xs font-medium',
        className
      )}
    >
      {SUPPORTED_LOCALES.map((loc) => (
        <button
          key={loc}
          type="button"
          aria-pressed={locale === loc}
          onClick={() => setLocale(loc)}
          className={cn(
            'rounded-md px-2 py-1 transition-colors',
            locale === loc
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-primary'
          )}
        >
          {LOCALE_LABELS[loc]}
        </button>
      ))}
    </div>
  )
}
