import { describe, it, expect } from 'vitest'
import { cancellationErrorMessage } from '@/lib/httpError'

function httpError(status: number, detail?: string) {
  return { response: { status, data: detail ? { detail } : {} } }
}

describe('cancellationErrorMessage (C07)', () => {
  it('explains the 24h rule from the backend 400', () => {
    expect(cancellationErrorMessage(httpError(400, 'Bookings can only be cancelled more than 24 hours in advance')))
      .toMatch(/24 horas/)
  })
  it('explains an already cancelled or completed booking', () => {
    expect(cancellationErrorMessage(httpError(400, 'Booking is already cancelled'))).toMatch(/já foi cancelada/)
    expect(cancellationErrorMessage(httpError(400, 'Booking is already completed'))).toMatch(/já terminou/)
  })
  it('maps 403, 404, 401 and 429', () => {
    expect(cancellationErrorMessage(httpError(403))).toMatch(/não é sua/i)
    expect(cancellationErrorMessage(httpError(404))).toMatch(/não encontr/i)
    expect(cancellationErrorMessage(httpError(401))).toMatch(/sessão/i)
    expect(cancellationErrorMessage(httpError(429))).toMatch(/tentativas|aguarde/i)
  })
  it('distinguishes a network failure from a server rejection', () => {
    expect(cancellationErrorMessage(new Error('Network Error'))).toMatch(/ligação/i)
  })
  it('never promises a refund', () => {
    for (const e of [httpError(400, 'x'), httpError(500), new Error('boom')]) {
      expect(cancellationErrorMessage(e)).not.toMatch(/reembols/i)
    }
  })
})

import { bookingErrorMessage } from '@/lib/httpError'

describe('bookingErrorMessage (B31)', () => {
  it('keeps the 409 distinction between a taken slot and missing pack hours', () => {
    expect(bookingErrorMessage(httpError(409, 'This time slot is already booked'), 'hourly')).toMatch(/já está reservado/)
    expect(bookingErrorMessage(httpError(409, 'This time slot is already booked'), 'package')).toMatch(/já está reservado/)
    expect(bookingErrorMessage(httpError(409, 'No active package with 3 hours remaining'), 'package')).toMatch(/horas suficientes/)
  })
  it('tells a retried mixed hold that its pack hours are gone, whatever method the caller passes (C13)', () => {
    const gone = httpError(409, 'The package no longer has the hours this booking reserved')
    for (const method of ['hourly', 'mixed', 'package'] as const) {
      expect(bookingErrorMessage(gone, method)).toMatch(/pack/i)
      expect(bookingErrorMessage(gone, method)).not.toMatch(/já está reservado/)
    }
  })
  it('tells a customer whose retry hit an already-paid session to wait for confirmation', () => {
    expect(bookingErrorMessage(httpError(409, 'Payment already received for this booking; waiting for confirmation'), 'hourly'))
      .toMatch(/já foi recebido/)
  })
  it('explains a past start and hours outside opening time', () => {
    expect(bookingErrorMessage(httpError(400, 'start_time cannot be in the past'), 'hourly')).toMatch(/já passou/)
    // H01: the horizon, with the number of days and the last date.
    expect(bookingErrorMessage(httpError(400, 'start_time is beyond the booking window'), 'hourly')).toMatch(/30 dias de antecedência.*Escolha uma data até \d+ de \w+/)
    expect(bookingErrorMessage(httpError(400, "Requested time is outside the room's opening hours"), 'hourly')).toMatch(/horário de funcionamento/)
    expect(bookingErrorMessage(httpError(400, 'end_time must be after start_time'), 'hourly')).toMatch(/não é válido/)
  })
  it('maps an expired session, a non-member, throttling and a payment start failure', () => {
    expect(bookingErrorMessage(httpError(401), 'hourly')).toMatch(/sessão/i)
    expect(bookingErrorMessage(httpError(403, 'You are not a member of this organization'), 'hourly')).toMatch(/inscrit/i)
    expect(bookingErrorMessage(httpError(429), 'hourly')).toMatch(/aguarde/i)
    expect(bookingErrorMessage(httpError(502, 'Could not start the payment session'), 'hourly')).toMatch(/pagamento/i)
  })
  it('names a network failure and keeps the generic fallback for the rest', () => {
    expect(bookingErrorMessage(new Error('Network Error'), 'hourly')).toMatch(/ligação/i)
    expect(bookingErrorMessage(httpError(500), 'hourly')).toMatch(/Erro ao criar reserva/)
  })
})
