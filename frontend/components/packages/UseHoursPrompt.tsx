'use client'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * B70: the one step a customer with hours in the bank is left guessing —
 * how to spend them. Shown after a purchase, in the packs page's empty
 * state and on every pack card: one line and the way to the rooms.
 */
export function UseHoursPrompt({ className, compact = false }: { className?: string; compact?: boolean }) {
  const t = useT()
  return (
    <div data-testid="use-hours-prompt" className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', compact ? 'text-xs' : 'text-sm', className)}>
      <span>{t('packs.use_hours_line')}</span>
      <Link href="/spaces" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
        {t('packs.use_hours_cta')}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </div>
  )
}
