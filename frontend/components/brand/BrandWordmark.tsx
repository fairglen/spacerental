import { brandBoxes } from '@/components/brand/brandBoxes.generated'
import { BRAND_WORDMARK_ID } from '@/components/brand/brandIds'

interface BrandWordmarkProps {
  /** Rendered height in CSS pixels; the width follows the wordmark's viewBox. */
  height: number
  className?: string
}

/**
 * B51: the "FlowSpace" lettering alone as inline SVG, for the header — the
 * link around it carries the accessible name, so the drawing is
 * `aria-hidden`. Takes `currentColor`. Needs <BrandSymbols> on the page.
 */
export function BrandWordmark({ height, className }: BrandWordmarkProps) {
  const { viewBox, width: w, height: h } = brandBoxes.wordmark
  return (
    <svg className={className} width={Math.round((height * w) / h)} height={height} viewBox={viewBox} aria-hidden="true" focusable="false">
      <use href={`#${BRAND_WORDMARK_ID}`} />
    </svg>
  )
}
