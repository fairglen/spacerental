import { brandPaths } from '@/components/brand/brandPaths.generated'
import { BRAND_MARK_ID, BRAND_WORDMARK_ID } from '@/components/brand/brandIds'

// B51: the brand mark and the wordmark, inlined once per page as <symbol>s
// (a server component in the root layout — the path data never reaches the
// client bundle; the drawers import brandBoxes.generated, not this module). <BrandMark> and <BrandWordmark> draw them with
// `<use href="#brand-…">`: no request, the colour inherited from the parent,
// the same markup the static site generates (scripts/render-static.py).
export { BRAND_MARK_ID, BRAND_WORDMARK_ID } from '@/components/brand/brandIds'

export function BrandSymbols() {
  const { mark, wordmark } = brandPaths
  return (
    // Not `display: none`: WebKit will not draw a <use> whose <symbol> lives in a hidden svg.
    <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: 'absolute', overflow: 'hidden' }}>
      <symbol id={BRAND_MARK_ID} viewBox={mark.viewBox}>
        <path fill="currentColor" fillRule={mark.fillRule} d={mark.d} />
      </symbol>
      <symbol id={BRAND_WORDMARK_ID} viewBox={wordmark.viewBox}>
        <path fill="currentColor" fillRule={wordmark.fillRule} d={wordmark.d} />
      </symbol>
    </svg>
  )
}
