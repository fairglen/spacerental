// B51: the ids <BrandSymbols> defines and <BrandMark>/<BrandWordmark> reference.
// Its own module so the drawers (client components) never import
// BrandSymbols — and with it the path data — into the browser bundle.
export const BRAND_MARK_ID = 'brand-mark'
export const BRAND_WORDMARK_ID = 'brand-wordmark'
