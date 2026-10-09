import { brandBoxes } from '@/components/brand/brandBoxes.generated'
import { BRAND_WORDMARK_ID } from '@/components/brand/brandIds'

interface BrandWordmarkProps {
  /** Rendered height in CSS pixels; the width follows the wordmark's viewBox. */
  height: number
  className?: string
}

/**
 * B51: the "FlowSpace" lettering alone as inline SVG — the link around it
 * carries the accessible name, so the drawing is `aria-hidden`. Takes
 * `currentColor`. Needs <BrandSymbols> on the page. (The header shows the
 * mark since B58; this stays for any lockup that wants the lettering.)
 *
 * B57: the outer viewBox starts at the origin — see BrandMark.
 */
export function BrandWordmark({ height, className }: BrandWordmarkProps) {
  const { width: w, height: h } = brandBoxes.wordmark
  return (
    <svg className={className} width={Math.round((height * w) / h)} height={height} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      <use href={`#${BRAND_WORDMARK_ID}`} />
    </svg>
  )
}
