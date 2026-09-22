import { format } from 'date-fns'
import { pt } from 'date-fns/locale'
import { bookingMaxAdvanceDays, bookingWindowEnd } from '@/lib/bookingWindow'

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
 * Portuguese explanation for a failed `DELETE /bookings/{id}` (C07). Maps the
 * backend's own rejections; the backend stays authoritative, this only puts
 * words to its answer. Deliberately says nothing about refunds — O02 has not
 * defined a refund policy.
 */
export function cancellationErrorMessage(error: unknown): string {
  const status = statusOf(error)
  const detail = detailOf(error)?.toLowerCase() ?? ''
  if (status === 400) {
    if (detail.includes('24 hours')) {
      return 'Só é possível cancelar com pelo menos 24 horas de antecedência. Esta reserva já está dentro desse prazo.'
    }
    if (detail.includes('already cancelled')) return 'Esta reserva já foi cancelada.'
    if (detail.includes('already completed')) return 'Esta reserva já terminou e não pode ser cancelada.'
    return 'Não foi possível cancelar esta reserva.'
  }
  if (status === 401) return 'A sua sessão expirou. Entre de novo para cancelar a reserva.'
  if (status === 403) return 'Esta reserva não é sua, por isso não a pode cancelar.'
  if (status === 404) return 'Reserva não encontrada. Pode já ter sido removida.'
  if (status === 429) return 'Demasiadas tentativas. Aguarde um momento e tente de novo.'
  if (status === undefined) return 'Sem ligação ao servidor. Verifique a internet e tente novamente.'
  return 'Não foi possível cancelar a reserva. Tente novamente daqui a pouco.'
}

export type BookingPaymentMethod = 'hourly' | 'package' | 'mixed'

/**
 * Portuguese explanation for a failed `POST /bookings` (B31). Everything that
 * is not a 409 used to collapse into "Erro ao criar reserva". Kept here, next
 * to `cancellationErrorMessage`, so other screens can reuse the same words.
 */
export function bookingErrorMessage(error: unknown, method: BookingPaymentMethod): string {
  const status = statusOf(error)
  const detail = detailOf(error)?.toLowerCase() ?? ''
  switch (status) {
    case 409: {
      if (detail.includes('already received')) {
        return 'O pagamento desta reserva já foi recebido. A confirmação aparece em instantes.'
      }
      // Retrying an expired mixed hold needs the same pack hours again (C13).
      if (detail.includes('package no longer has')) {
        return 'O seu pack já não tem as horas que esta reserva tinha guardadas. Faça uma nova reserva para ver o novo valor.'
      }
      const slotTaken = detail.includes('time slot') || detail.includes('horário') || detail.includes('reservado')
      return method !== 'hourly' && !slotTaken
        ? 'O seu pack já não tem horas suficientes para esta reserva.'
        : 'Este horário já está reservado. Escolha outro intervalo no calendário.'
    }
    case 400:
      if (detail.includes('past')) return 'Essa hora já passou. Escolha um horário a partir de agora.'
      if (detail.includes('booking window')) {
        // H01: the API's horizon; the date is the calendar's own hint.
        return `Só é possível reservar com ${bookingMaxAdvanceDays()} dias de antecedência, no máximo. Escolha uma data até ${format(bookingWindowEnd(), "d 'de' MMMM", { locale: pt })}.`
      }
      if (detail.includes('opening hours')) {
        return 'O horário escolhido está fora do horário de funcionamento da sala.'
      }
      return 'O horário escolhido não é válido. Volte a selecionar as horas no calendário.'
    case 401:
      return 'A sua sessão expirou. Entre de novo para concluir a reserva.'
    case 403:
      return 'A sua conta ainda não está inscrita neste espaço. Contacte o espaço para se inscrever.'
    case 404:
      return 'Esta sala já não está disponível para reservas.'
    case 429:
      return 'Demasiados pedidos seguidos. Aguarde um momento e tente de novo.'
    case 502:
      return 'Não foi possível iniciar o pagamento. Tente novamente daqui a pouco.'
    case undefined:
      return 'Sem ligação ao servidor. Verifique a internet e tente novamente.'
    default:
      return 'Erro ao criar reserva. Tente novamente.'
  }
}
