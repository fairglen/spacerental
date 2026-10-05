// The shape work behind /api/csp-report (Q52), kept out of the route module:
// a Next.js route file may only export its handlers.
//
// The endpoint is public and unauthenticated by nature (the browser posts to
// it on the user's behalf), so everything it accepts is bounded (review on
// #71): the body size, the content types, the number of reports per request,
// the length of every logged field, and the rate — per report, per client when
// a trusted proxy identifies clients (CSP_REPORT_TRUSTED_PROXIES), otherwise
// for the process as a whole. URLs are logged without query strings and with
// token-like path segments redacted — a violation on /reset-password/<token>
// must not put the token in the logs.

export type CspReport = Record<string, unknown>

export const MAX_BODY_BYTES = 16 * 1024
export const MAX_REPORTS = 10
export const MAX_FIELD_LENGTH = 300
export const ACCEPTED_CONTENT_TYPES = ['application/csp-report', 'application/reports+json', 'application/json']
export const RATE_LIMIT = { max: 30, windowMs: 60_000, maxClients: 1_000 }

/** The reports in a request body: the legacy `{"csp-report": {...}}` object or the Reporting API's array. */
export function reportsIn(body: unknown): CspReport[] {
  if (Array.isArray(body)) {
    return body.slice(0, MAX_REPORTS).map((entry) => {
      const inner = entry && typeof entry === 'object' && 'body' in entry ? (entry as { body: unknown }).body : entry
      return inner && typeof inner === 'object' ? (inner as CspReport) : {}
    })
  }
  if (body && typeof body === 'object') {
    const legacy = (body as Record<string, unknown>)['csp-report']
    return [legacy && typeof legacy === 'object' ? (legacy as CspReport) : (body as CspReport)]
  }
  return []
}

const URL_FIELDS = new Set(['document-uri', 'documentURL', 'blocked-uri', 'blockedURL', 'source-file', 'sourceFile', 'referrer'])
const FIELDS = ['document-uri', 'documentURL', 'violated-directive', 'effectiveDirective', 'blocked-uri', 'blockedURL', 'source-file', 'sourceFile', 'line-number', 'lineNumber']
// Path segments that are plainly identifiers or tokens (long, opaque) are
// not needed to understand a violation; the route shape is.
const OPAQUE_SEGMENT = /^[A-Za-z0-9_-]{16,}$/

/** A URL fit for a log line: no query, no fragment, opaque path segments redacted. */
export function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value)
    const path = url.pathname
      .split('/')
      .map((segment) => (OPAQUE_SEGMENT.test(segment) ? '[redacted]' : segment))
      .join('/')
    return `${url.origin}${path}`
  } catch {
    // Not a URL (`eval`, `inline`, `data`, `self`): keep the keyword, bounded.
    return value.replace(/[?#].*$/, '').slice(0, 80)
  }
}

/** The fields worth one log line — never the whole policy, a script sample, a query string or a token. */
export function summarize(report: CspReport): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of FIELDS) {
    if (!(key in report)) continue
    const value = report[key]
    if (typeof value === 'string') out[key] = (URL_FIELDS.has(key) ? sanitizeUrl(value) : value).slice(0, MAX_FIELD_LENGTH)
    else if (typeof value === 'number') out[key] = value
  }
  return out
}

/**
 * A small sliding window of *reports* per client, bounded in clients too; per
 * process like the API's limiter. One request is charged for every report it
 * carries, so a Reporting API batch of MAX_REPORTS costs MAX_REPORTS, not one
 * (review on #71, round 2).
 */
export class ReportRateLimiter {
  private hits = new Map<string, number[]>()
  constructor(private readonly max = RATE_LIMIT.max, private readonly windowMs = RATE_LIMIT.windowMs, private readonly maxClients = RATE_LIMIT.maxClients) {}

  private recent(client: string, now: number): number[] {
    const since = now - this.windowMs
    const recent = (this.hits.get(client) ?? []).filter((t) => t > since)
    this.hits.set(client, recent)
    return recent
  }

  /** Nothing left in the window: the cheap answer before a body is read. */
  exhausted(client: string, now = Date.now()): boolean {
    return this.recent(client, now).length >= this.max
  }

  /** Charge `cost` reports to `client`; false, and nothing charged, when the window cannot take them all. */
  allow(client: string, cost = 1, now = Date.now()): boolean {
    const recent = this.recent(client, now)
    if (recent.length + cost > this.max) return false
    for (let i = 0; i < cost; i++) recent.push(now)
    if (this.hits.size > this.maxClients) {
      // Drop the oldest client rather than grow without bound.
      const oldest = this.hits.keys().next().value
      if (oldest !== undefined) this.hits.delete(oldest)
    }
    return true
  }
}

/** Read at most `limit` bytes of the body; null when it is larger than that. */
export async function readBounded(request: Request, limit = MAX_BODY_BYTES): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > limit) return null
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))))
}

export function acceptsContentType(contentType: string | null): boolean {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase()
  return ACCEPTED_CONTENT_TYPES.includes(type)
}

/**
 * How many reverse proxies the deployment controls stand in front of Next.js —
 * the same opt-in the API's limiter has (RATE_LIMIT_TRUST_FORWARDED_FOR). 0,
 * the default, means X-Forwarded-For is not trusted at all: Next.js only fills
 * it from the socket when the header is absent, so a direct caller can send
 * any value, and there is no peer address a route handler could fall back to.
 */
export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const raw = env.CSP_REPORT_TRUSTED_PROXIES?.trim()
  if (!raw) return 0
  if (!/^\d+$/.test(raw)) throw new Error(`CSP_REPORT_TRUSTED_PROXIES must be a whole number of proxies, got ${JSON.stringify(raw)}`)
  return Number(raw)
}

/** One bucket for every caller when no proxy is trusted; the limit is then a bound on the log, not per client. */
export const SHARED_CLIENT = 'shared'

/**
 * The client a request is charged to. With `hops` trusted proxies, each one
 * appended the address it saw, so the client is the `hops`-th entry from the
 * right of X-Forwarded-For (a shorter header than that: its first entry).
 */
export function clientOf(request: Request, hops = trustedProxyHops()): string {
  if (hops === 0) return SHARED_CLIENT
  const entries = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (entries.length === 0) return SHARED_CLIENT
  return entries[Math.max(0, entries.length - hops)]
}
