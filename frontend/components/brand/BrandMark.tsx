import { brandBoxes } from '@/components/brand/brandBoxes.generated'
import { BRAND_MARK_ID } from '@/components/brand/brandIds'

interface BrandMarkProps {
  /** Rendered width in CSS pixels; the height follows the mark's viewBox. */
  width: number
  className?: string
}

/**
 * B51: the brand mark (frame, chairs, spiral) as inline SVG — decorative, so
 * `aria-hidden`; it takes `currentColor`. Explicit width/height attributes
 * reserve its box before paint (CLS 0). Needs <BrandSymbols> on the page.
 */
export function BrandMark({ width, className }: BrandMarkProps) {
  const { viewBox, width: w, height: h } = brandBoxes.mark
  return (
    <svg className={className} width={width} height={Math.round((width * h) / w)} viewBox={viewBox} aria-hidden="true" focusable="false">
      <use href={`#${BRAND_MARK_ID}`} />
    </svg>
  )
}
