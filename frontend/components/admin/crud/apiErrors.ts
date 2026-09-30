/**
 * What an API refusal means for a form (G05).
 *
 * FastAPI answers 422 with `detail: [{ loc: ['body', 'field', ...], msg }]`
 * — those become inline field errors — or, for our own validators, with a
 * plain string; a 409 carries `detail: { message, blockers }` (G02) or a
 * string. Everything else is a banner with the best sentence available.
 */
import { statusOf } from '@/lib/httpError'

export type FormApiError = {
  status?: number
  fields: Record<string, string>
  message?: string
  blockers?: unknown
}

type Detail = string | { message?: string; blockers?: unknown } | Array<{ loc?: unknown[]; msg?: string }>

function detailOf(error: unknown): Detail | undefined {
  const data = (error as { response?: { data?: { detail?: Detail } } })?.response?.data
  return data?.detail
}

export function parseApiError(error: unknown, fallback = 'Não foi possível guardar. Tente novamente.'): FormApiError {
  const status = statusOf(error)
  const detail = detailOf(error)
  const fields: Record<string, string> = {}
  if (Array.isArray(detail)) {
    for (const item of detail) {
      const loc = Array.isArray(item.loc) ? item.loc.filter((p) => p !== 'body') : []
      const field = loc.map(String).join('.')
      if (field && item.msg) fields[field] = item.msg.replace(/^Value error, /, '')
    }
    return { status, fields, message: Object.keys(fields).length ? undefined : fallback }
  }
  if (typeof detail === 'string') return { status, fields, message: detail }
  if (detail && typeof detail === 'object') {
    return { status, fields, message: detail.message ?? fallback, blockers: detail.blockers }
  }
  if (status === undefined) return { status, fields, message: 'Sem ligação ao servidor. Verifique a internet e tente novamente.' }
  return { status, fields, message: fallback }
}

/** The blockers of a refused delete as readable lines, whatever their shape. */
export function blockerLines(blockers: unknown): string[] {
  if (!blockers) return []
  if (Array.isArray(blockers)) {
    return blockers.map((b) => {
      if (b && typeof b === 'object') {
        const o = b as Record<string, unknown>
        if ('name' in o && 'bookings' in o) return `${String(o.name)}: ${String(o.bookings)} reserva(s)`
        if ('booking_id' in o && 'hours' in o) return `Reserva ${String(o.booking_id).slice(0, 8)}: ${String(o.hours)} h${o.room_name ? ` · ${String(o.room_name)}` : ''}`
        return Object.entries(o).map(([k, v]) => `${k}: ${String(v)}`).join(', ')
      }
      return String(b)
    })
  }
  if (typeof blockers === 'object') {
    const labels: Record<string, string> = {
      bookings: 'reservas', blocks: 'bloqueios', purchases: 'compras', support_requests: 'pedidos de ajuda',
      amount_paid: 'valor pago', debits: 'reservas a descontar horas',
    }
    return Object.entries(blockers as Record<string, unknown>).map(([k, v]) => `${labels[k] ?? k}: ${String(v)}`)
  }
  return [String(blockers)]
}
