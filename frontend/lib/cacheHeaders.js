// Cache-Control for what Next serves itself (P2.1), consumed by
// next.config.js's `headers()` next to the security headers. Plain CommonJS
// for the same reason as lib/securityHeaders.js.
//
// /brand/** is the brand set copied from the static site (B50): favicons,
// the logos, the Open Graph card, the manifest. Next already serves its own
// hashed chunks as immutable; these files are not hashed, so "immutable" is
// a promise that a changed asset gets a new name — the parity test
// (tests/lib/brandParity.test.ts) is where that change would show up.

const BRAND_CACHE_CONTROL = 'public, max-age=31536000, immutable'

function cacheHeaders() {
  return [{ source: '/brand/:path*', headers: [{ key: 'Cache-Control', value: BRAND_CACHE_CONTROL }] }]
}

module.exports = { cacheHeaders, BRAND_CACHE_CONTROL }
