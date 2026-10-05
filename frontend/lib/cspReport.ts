// The shape work behind /api/csp-report (Q52), kept out of the route module:
// a Next.js route file may only export its handlers.
//
// The endpoint is public and unauthenticated by nature (the browser posts to
// it on the user's behalf), so everything it accepts is bounded (review on
// #71): the body size, the content types, the number of reports per request,
// the length of every logged field, and the rate per client. URLs are logged
// without query strings and with token-like path segments redacted — a
// violation on /reset-password/<token> must not put the token in the logs.

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

/** A small sliding window per client, bounded in clients too; per process like the API's limiter. */
export class ReportRateLimiter {
  private hits = new Map<string, number[]>()
  constructor(private readonly max = RATE_LIMIT.max, private readonly windowMs = RATE_LIMIT.windowMs, private readonly maxClients = RATE_LIMIT.maxClients) {}
  allow(client: string, now = Date.now()): boolean {
    const since = now - this.windowMs
    const recent = (this.hits.get(client) ?? []).filter((t) => t > since)
    if (recent.length >= this.max) {
      this.hits.set(client, recent)
      return false
    }
    recent.push(now)
    this.hits.set(client, recent)
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

export function clientOf(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  return (forwarded ? forwarded.split(',')[0] : request.headers.get('x-real-ip') ?? 'unknown').trim()
}
