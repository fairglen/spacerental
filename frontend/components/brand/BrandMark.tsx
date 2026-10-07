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
 *
 * B57: the outer viewBox starts at the origin. A <use> draws the symbol at
 * (0,0) of this svg, and the symbol's own viewBox already maps the file's
 * offset drawing onto it; repeating the file's offset here pushed the
 * drawing out of the viewport (the clipped, off-centre hero mark).
 */
export function BrandMark({ width, className }: BrandMarkProps) {
  const { width: w, height: h } = brandBoxes.mark
  return (
    <svg className={className} width={width} height={Math.round((width * h) / w)} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      <use href={`#${BRAND_MARK_ID}`} />
    </svg>
  )
}
