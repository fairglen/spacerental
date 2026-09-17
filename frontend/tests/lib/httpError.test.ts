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
    expect(cancellationErrorMessage(httpError(403))).toMatch(/não é tua/i)
    expect(cancellationErrorMessage(httpError(404))).toMatch(/não encontr/i)
    expect(cancellationErrorMessage(httpError(401))).toMatch(/sessão/i)
    expect(cancellationErrorMessage(httpError(429))).toMatch(/tentativas|aguarda/i)
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
