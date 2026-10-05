// The shape work behind /api/csp-report (Q52), kept out of the route module:
// a Next.js route file may only export its handlers.

export type CspReport = Record<string, unknown>

/** The reports in a request body: the legacy `{"csp-report": {...}}` object or the Reporting API's array. */
export function reportsIn(body: unknown): CspReport[] {
  if (Array.isArray(body)) {
    return body.map((entry) => {
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

const FIELDS = ['document-uri', 'documentURL', 'violated-directive', 'effectiveDirective', 'blocked-uri', 'blockedURL', 'source-file', 'sourceFile', 'line-number', 'lineNumber']

/** The fields worth one log line — never the whole policy or a script sample. */
export function summarize(report: CspReport): Record<string, unknown> {
  return Object.fromEntries(FIELDS.filter((key) => key in report).map((key) => [key, report[key]]))
}
