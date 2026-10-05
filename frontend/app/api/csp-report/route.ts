// Where the browser posts Content-Security-Policy violations (Q52). The
// policy is report-only: nothing is blocked, but everything a stricter policy
// WOULD block lands here as one log line, so the policy can be tightened from
// evidence (TODO.md Q56) — the e2e run's frontend logs are the first report.
// Public and unauthenticated by nature, so bounded on every axis (review on
// #71): content type, body size, reports per request, field length, rate.
import { ReportRateLimiter, acceptsContentType, clientOf, readBounded, reportsIn, summarize } from '@/lib/cspReport'

const limiter = new ReportRateLimiter()

export async function POST(request: Request): Promise<Response> {
  if (!acceptsContentType(request.headers.get('content-type'))) return new Response(null, { status: 415 })
  const client = clientOf(request)
  // A client with nothing left is refused before its body is read.
  if (limiter.exhausted(client)) return new Response(null, { status: 429 })
  const text = await readBounded(request)
  if (text === null) return new Response(null, { status: 413 })
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    // Not JSON: nothing to record, but never an error back to a browser.
  }
  const reports = reportsIn(body)
  // Charged per report, so a batch cannot multiply the rate; an empty or
  // unparsable body still costs one.
  if (!limiter.allow(client, Math.max(1, reports.length))) return new Response(null, { status: 429 })
  for (const report of reports) {
    console.warn('[csp-report]', JSON.stringify(summarize(report)))
  }
  return new Response(null, { status: 204 })
}
