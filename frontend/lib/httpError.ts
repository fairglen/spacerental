import { t } from '@/lib/i18n'

// D26: no date-fns here — every page that calls the API imports this
// module, the landing included; `bookingErrorMessage` lives in
// lib/bookingErrors.ts with the date it needs.

/**
 * HTTP status of a failed request, without importing axios into a component
 * (§9 keeps API concerns in lib/api.ts). Undefined for network-level failures.
 *
 * Shared by every mutation that follows the Checkout pattern (bookings,
 * packages, …) so the "was this a 409/403/etc." check isn't reimplemented
 * per component.
 */
export function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) return undefined
  const response = (error as { response?: unknown }).response
  if (typeof response !== 'object' || response === null || !('status' in response)) return undefined
  const status = (response as { status?: unknown }).status
  return typeof status === 'number' ? status : undefined
}

export function detailOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) return undefined
  const response = (error as { response?: unknown }).response
  if (typeof response !== 'object' || response === null || !('data' in response)) return undefined
  const data = (response as { data?: unknown }).data
  if (typeof data !== 'object' || data === null || !('detail' in data)) return undefined
  const detail = (data as { detail?: unknown }).detail
  return typeof detail === 'string' ? detail : undefined
}

/**
 * The `conflicts` array from a recurrence 409 (`POST /recurrences`,
 * `PUT /recurrences/{id}`) — ISO instants of the occurrences already taken.
 * Undefined for any error that doesn't carry that shape, including a plain
 * single-booking 409 (which has no `conflicts` field).
 */
export function conflictsOf(error: unknown): string[] | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) return undefined
  const response = (error as { response?: unknown }).response
  if (typeof response !== 'object' || response === null || !('data' in response)) return undefined
  const data = (response as { data?: unknown }).data
  if (typeof data !== 'object' || data === null || !('conflicts' in data)) return undefined
  const conflicts = (data as { conflicts?: unknown }).conflicts
  if (!Array.isArray(conflicts)) return undefined
  return conflicts.filter((c): c is string => typeof c === 'string')
}

/**
 * Explanation, in the browser's locale (B65), for a failed
 * `DELETE /bookings/{id}` (C07). Maps the backend's own rejections; the
 * backend stays authoritative, this only puts words to its answer.
 * Deliberately says nothing about refunds — O02 has not defined a refund
 * policy.
 */
export function cancellationErrorMessage(error: unknown): string {
  const status = statusOf(error)
  const detail = detailOf(error)?.toLowerCase() ?? ''
  if (status === 400) {
    if (detail.includes('24 hours')) return t('errors.cancel_24h')
    if (detail.includes('already cancelled')) return t('errors.cancel_already_cancelled')
    if (detail.includes('already completed')) return t('errors.cancel_already_completed')
    return t('errors.cancel_400')
  }
  if (status === 401) return t('errors.cancel_401')
  if (status === 403) return t('errors.cancel_403')
  if (status === 404) return t('errors.cancel_404')
  // K01: only an operator's price override can make the credit too large for
  // the hour bank; retrying changes nothing, a person has to fix the amount.
  if (status === 409 && detail.includes('exceeds what the hour bank')) return t('errors.cancel_credit_exceeds')
  if (status === 429) return t('errors.cancel_429')
  if (status === undefined) return t('errors.offline')
  return t('errors.cancel_default')
}
