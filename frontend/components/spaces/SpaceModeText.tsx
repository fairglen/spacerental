'use client'
import { useSingleSpace } from '@/lib/hooks/useSingleSpace'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface SpaceModeTextProps {
  /** Catalog key used while exactly one space is publicly visible. */
  single: string
  /** Catalog key used otherwise — today's wording. */
  multi: string
  skeletonClassName?: string
}

/**
 * A label that talks about rooms while there is one space and about spaces
 * when there are several (C11). Until the mode is known it is a skeleton, so
 * the page never says "Espaços" and then changes its mind.
 */
export function SpaceModeText({ single, multi, skeletonClassName }: SpaceModeTextProps) {
  const t = useT()
  const { mode } = useSingleSpace()
  if (mode === 'loading') {
    return (
      <>
        {/* A span: this sits inside links and headings, where a div is invalid. */}
        <span
          data-testid="mode-text-skeleton"
          aria-hidden
          className={cn('inline-block h-3 w-12 animate-pulse rounded bg-[#E8F4F0] align-middle', skeletonClassName)}
        />
        <span className="sr-only">{t('common.loading')}</span>
      </>
    )
  }
  return <>{t(mode === 'single' ? single : multi)}</>
}
