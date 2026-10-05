// Security headers for every route (Q52), consumed by next.config.js's
// `headers()`. Plain CommonJS so the config can require it and Vitest can
// import it without a build step.
//
// - X-Content-Type-Options, Referrer-Policy and Permissions-Policy everywhere.
// - X-Frame-Options: DENY everywhere too — `frame-ancestors 'none'` is in the
//   policy for every page, but the policy is report-only, so this is what
//   actually keeps the sign-in and password-reset forms out of a frame
//   (review on #71, round 6). Nothing of ours is meant to be embedded.
// - Strict-Transport-Security only in a production build: browsers ignore it
//   over plain HTTP, so it is harmless on a laptop and takes effect behind
//   TLS. It commits browsers to HTTPS for two years — deploy behind TLS first.
// - Content-Security-Policy-REPORT-ONLY: nothing is blocked yet. Violations
//   are posted to /api/csp-report (app/api/csp-report/route.ts logs them) so
//   the policy can be tightened from what is really seen before it enforces
//   (TODO.md Q56). What it allows: this origin, the API origin (XHR and the
//   photos it serves), an optional separate media origin, the OpenStreetMap
//   frame in "Onde estamos", inline styles/scripts (Next.js hydration), and
//   `unsafe-eval` only outside production (the dev server's HMR).

// Development only. A production build must name the real API origin, or
// the policy would allow the wrong one and every browser call would fail
// quietly once deployed (review on #71, round 7): it throws instead.
const DEV_API_FALLBACK = 'http://localhost:8000/api/v1'

function originOf(url) {
  return new URL(url).origin
}

function contentSecurityPolicy({ production, apiOrigin, mediaOrigin }) {
  const sources = [apiOrigin, mediaOrigin].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i)
  const script = ["'self'", "'unsafe-inline'", ...(production ? [] : ["'unsafe-eval'"])]
  return [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${sources.join(' ')}`.trim(),
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin}`,
    'frame-src https://www.openstreetmap.org',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'report-uri /api/csp-report',
  ].join('; ')
}

/**
 * The `headers()` rules. Arguments default to the process environment; the
 * tests pass them explicitly.
 */
function securityHeaders({
  nodeEnv = process.env.NODE_ENV,
  apiUrl = process.env.NEXT_PUBLIC_API_URL,
  mediaOrigin = process.env.NEXT_PUBLIC_MEDIA_ORIGIN || '',
} = {}) {
  const production = nodeEnv === 'production'
  if (!apiUrl) {
    if (production) {
      throw new Error('NEXT_PUBLIC_API_URL is required for a production build: the security policy must name the real API origin')
    }
    apiUrl = DEV_API_FALLBACK
  }
  const apiOrigin = originOf(apiUrl)
  const everywhere = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ...(production ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
    {
      key: 'Content-Security-Policy-Report-Only',
      value: contentSecurityPolicy({ production, apiOrigin, mediaOrigin: mediaOrigin ? originOf(mediaOrigin) : '' }),
    },
  ]
  // The root path has its own rule: `/:path*` does not match `/`.
  return [
    { source: '/:path*', headers: everywhere },
    { source: '/', headers: everywhere },
  ]
}

module.exports = { securityHeaders, contentSecurityPolicy }
