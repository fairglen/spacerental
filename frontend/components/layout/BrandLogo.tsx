import { cn } from '@/lib/utils'

/** The lockup's viewBox (flowspace-site/assets/img/brand/logo-horizontal.svg). */
export const LOCKUP_VIEWBOX = { width: 3058.4, height: 749.2 }
const RATIO = LOCKUP_VIEWBOX.width / LOCKUP_VIEWBOX.height

interface BrandLogoProps {
  /** Rendered height in px; the width follows the viewBox, so nothing shifts while it loads. */
  height: number
  className?: string
}

/**
 * The FlowSpace lockup (B50): mark left, wordmark right, from the one brand
 * set the static site uses (`public/brand/` is a byte-for-byte copy, see
 * `tests/lib/brandParity.test.ts`). Referenced through `<use>` rather than an
 * `<img>` so the file's `currentColor` follows the CSS `color` of wherever it
 * sits — green in the header, white in the footer — without a second asset.
 */
export function BrandLogo({ height, className }: BrandLogoProps) {
  const width = Math.round(height * RATIO * 10) / 10
  return (
    <svg
      role="img"
      aria-label="FlowSpace"
      width={width}
      height={height}
      viewBox={`0 0 ${LOCKUP_VIEWBOX.width} ${LOCKUP_VIEWBOX.height}`}
      className={cn('shrink-0', className)}
      style={{ width, height }}
    >
      <use href="/brand/logo-horizontal.svg#lockup" />
    </svg>
  )
}
