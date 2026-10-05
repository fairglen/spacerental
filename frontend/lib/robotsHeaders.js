// X-Robots-Tag for the private surface (S2.1), consumed by next.config.js's
// `headers()` next to the security and cache headers. Plain CommonJS for the
// same reason as lib/securityHeaders.js.
//
// The routes' metadata already says `noindex, nofollow` (lib/seo.ts), but a
// crawler that lands on /dashboard unauthenticated gets a redirect, not a
// page with a <meta> in it; the header answers on every response, redirects
// included. The rest of the app is `noindex, follow` through metadata only —
// a header would also hit the sign-up and landing pages' link previews, and
// those are the one thing the app wants crawlers to read.

const ROBOTS_PRIVATE_HEADER = 'noindex, nofollow'

const PRIVATE_SOURCES = ['/dashboard', '/dashboard/:path*', '/admin', '/admin/:path*', '/sign-in', '/reset-password/:path*']

function robotsHeaders() {
  return PRIVATE_SOURCES.map((source) => ({ source, headers: [{ key: 'X-Robots-Tag', value: ROBOTS_PRIVATE_HEADER }] }))
}

module.exports = { robotsHeaders, ROBOTS_PRIVATE_HEADER, PRIVATE_SOURCES }
