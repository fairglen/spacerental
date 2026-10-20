import { format } from 'date-fns'
import { bookingMaxAdvanceDays, bookingWindowEnd } from '@/lib/bookingWindow'
import { dateFnsLocale } from '@/lib/dates'
import { detailOf, statusOf } from '@/lib/httpError'
import { getLocale, t } from '@/lib/i18n'

// D26: apart from lib/httpError.ts, which every page that calls the API
// imports — the landing's "Comprar" button included — because the booking
// window's date brings date-fns (~18 KB gzipped) with it.

export type BookingPaymentMethod = 'hourly' | 'package' | 'mixed'

/**
 * Explanation, in the browser's locale (B65), for a failed `POST /bookings`
 * (B31). Everything that is not a 409 used to collapse into "Erro ao criar
 * reserva". Kept next to `cancellationErrorMessage`'s pattern so other
 * screens can reuse the same words.
 */
export function bookingErrorMessage(error: unknown, method: BookingPaymentMethod): string {
  const status = statusOf(error)
  const detail = detailOf(error)?.toLowerCase() ?? ''
  switch (status) {
    case 409: {
      if (detail.includes('already received')) return t('errors.booking_payment_received')
      // Retrying an expired mixed hold needs the same pack hours again (C13).
      if (detail.includes('package no longer has')) return t('errors.booking_pack_hours_gone')
      const slotTaken = detail.includes('time slot') || detail.includes('horário') || detail.includes('reservado')
      return method !== 'hourly' && !slotTaken ? t('errors.booking_pack_insufficient') : t('errors.booking_slot_taken')
    }
    case 400:
      if (detail.includes('past')) return t('errors.booking_past')
      if (detail.includes('booking window')) {
        // H01: the API's horizon; the date is the calendar's own hint.
        return t('errors.booking_window', {
          days: bookingMaxAdvanceDays(),
          date: format(bookingWindowEnd(), t('errors.booking_window_date_format'), { locale: dateFnsLocale(getLocale()) }),
        })
      }
      if (detail.includes('opening hours')) return t('errors.booking_opening_hours')
      return t('errors.booking_invalid_time')
    case 401:
      return t('errors.booking_401')
    case 403:
      return t('errors.booking_403')
    case 404:
      return t('errors.booking_404')
    case 429:
      return t('errors.too_many_requests')
    case 502:
      return t('errors.booking_502')
    case undefined:
      return t('errors.offline')
    default:
      return t('errors.booking_default')
  }
}
