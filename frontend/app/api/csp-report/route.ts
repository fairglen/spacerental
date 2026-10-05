// Where the browser posts Content-Security-Policy violations (Q52). The
// policy is report-only: nothing is blocked, but everything a stricter policy
// WOULD block lands here as one log line, so the policy can be tightened from
// evidence (TODO.md Q56) — the e2e run's frontend logs are the first report.
import { reportsIn, summarize } from '@/lib/cspReport'

export async function POST(request: Request): Promise<Response> {
  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    // Not JSON: nothing to record, but never an error back to a browser.
  }
  for (const report of reportsIn(body)) {
    console.warn('[csp-report]', JSON.stringify(summarize(report)))
  }
  return new Response(null, { status: 204 })
}
