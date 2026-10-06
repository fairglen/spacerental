// The one-origin API proxy (D20): the browser reaches the backend through
// this app's own origin — `/backend/*` is rewritten by next.config.js to the
// backend's internal origin — so the whole stack is one URL (one ngrok
// tunnel, one LAN address) and the API needs no CORS for the app. Plain
// CommonJS, like lib/securityHeaders.js: next.config.js requires it under
// `next dev` and `next start` (the Dockerfile copies it into the runner
// image) and Vitest imports it without a build step.
//
// Two addresses, never mixed (CLAUDE.md §6.3):
// - what the BROWSER calls: NEXT_PUBLIC_API_URL, relative by default, so it
//   follows whatever origin the page was opened at;
// - what the SERVER calls (NextAuth's authorize, the landing's render) and
//   where the proxy forwards: INTERNAL_API_URL, the Compose service name.

const PROXY_PREFIX = '/backend'
const DEFAULT_PUBLIC_API_URL = `${PROXY_PREFIX}/api/v1`
const DEFAULT_INTERNAL_API_URL = 'http://localhost:8000/api/v1'

/** @typedef {Record<string, string | undefined>} Env */

/** @param {string | undefined} url */
function isAbsolute(url) {
  return /^https?:\/\//i.test(url || '')
}

/**
 * The browser's API base: the env value, else the relative default.
 * @param {Env} [env]
 */
function publicApiUrl(env = process.env) {
  return env.NEXT_PUBLIC_API_URL || DEFAULT_PUBLIC_API_URL
}

/**
 * The API origin the browser talks to when it is NOT this site's own — null
 * for the relative default. Drives the CSP's connect-src/img-src extras and
 * the layout's preconnect; both are pointless for same-origin calls.
 * @param {Env} [env]
 * @returns {string | null}
 */
function publicApiOrigin(env = process.env) {
  const url = publicApiUrl(env)
  return isAbsolute(url) ? new URL(url).origin : null
}

/**
 * Where server-side code calls the API: INTERNAL_API_URL (the service name
 * inside Compose), else an ABSOLUTE NEXT_PUBLIC_API_URL (the frontend running
 * outside Docker against a reachable API), else localhost. The relative
 * default is never used here — Node cannot fetch a path.
 * @param {Env} [env]
 * @returns {string}
 */
function internalApiUrl(env = process.env) {
  if (env.INTERNAL_API_URL) return env.INTERNAL_API_URL
  if (isAbsolute(env.NEXT_PUBLIC_API_URL)) return /** @type {string} */ (env.NEXT_PUBLIC_API_URL)
  return DEFAULT_INTERNAL_API_URL
}

/**
 * The backend's origin the proxy forwards to: INTERNAL_API_URL without its /api/v1 path.
 * @param {Env} [env]
 */
function backendInternalOrigin(env = process.env) {
  return new URL(internalApiUrl(env)).origin
}

/**
 * The `rewrites()` of next.config.js.
 * @param {Env} [env]
 */
function backendRewrites(env = process.env) {
  return [{ source: `${PROXY_PREFIX}/:path*`, destination: `${backendInternalOrigin(env)}/:path*` }]
}

/**
 * The `X-Forwarded-For` the backend's limiter can believe (server.js). Next's
 * own proxy forwards the header as the client sent it and never appends the
 * peer address (verified against an echo server, D20), so a client could
 * pick its own identity; appending the socket's address makes the RIGHTMOST
 * entry ours — the one `RATE_LIMIT_TRUSTED_PROXIES` reads — whatever the
 * client wrote on the left.
 * @param {string | string[] | undefined} existing the incoming header, if any
 * @param {string | undefined} peer the socket's remote address
 * @returns {string | undefined}
 */
function appendForwardedFor(existing, peer) {
  if (!peer) return Array.isArray(existing) ? existing.join(', ') : existing
  const chain = (Array.isArray(existing) ? existing : [existing || ''])
    .flatMap((value) => value.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean)
  return [...chain, peer].join(', ')
}

module.exports = {
  PROXY_PREFIX,
  DEFAULT_PUBLIC_API_URL,
  DEFAULT_INTERNAL_API_URL,
  publicApiUrl,
  publicApiOrigin,
  internalApiUrl,
  backendInternalOrigin,
  backendRewrites,
  appendForwardedFor,
}
