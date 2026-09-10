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
