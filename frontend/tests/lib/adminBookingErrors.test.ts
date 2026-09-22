import { describe, it, expect } from 'vitest'
import { adminBookingErrorMessage } from '@/lib/adminBookingErrors'

const httpError = (status: number, detail?: string) => ({ response: { status, data: detail ? { detail } : {} } })

// H03 (c): the sheet shows the API's own reason, in Portuguese, instead of
// one generic sentence.
describe('adminBookingErrorMessage — a refused move', () => {
  it('tells a moved-back start apart from an end that has already passed', () => {
    expect(adminBookingErrorMessage(httpError(400, 'start_time cannot be in the past'))).toBe('Não é possível mover o início para antes de agora.')
    expect(adminBookingErrorMessage(httpError(400, 'end_time cannot be in the past'))).toBe('O fim tem de ser depois de agora.')
    expect(adminBookingErrorMessage(httpError(400, 'end_time must be after start_time'))).toBe('O fim tem de ser depois do início.')
  })

  it('names hours outside the room\'s opening and a conflict', () => {
    expect(adminBookingErrorMessage(httpError(400, "Requested time is outside the room's opening hours"))).toMatch(/horário de funcionamento/)
    expect(adminBookingErrorMessage(httpError(409, 'This time slot is already booked'))).toMatch(/já está reservado/)
  })

  it('explains a pack settle failure and any other refused constraint, never as a server error', () => {
    expect(adminBookingErrorMessage(httpError(409, 'The change violates a constraint (ck_bookings_package_hours_used_within_duration)'))).toMatch(/acertar as horas do pack/)
    expect(adminBookingErrorMessage(httpError(409, 'The change violates a constraint (uq_something)'))).toMatch(/recusada pela base de dados/)
    expect(adminBookingErrorMessage(httpError(409, 'The package no longer has enough hours to reinstate this booking'))).toMatch(/pack do cliente/)
  })

  it('falls back to a generic line for a real server error and a network failure', () => {
    expect(adminBookingErrorMessage(httpError(500))).toMatch(/Não foi possível guardar/)
    expect(adminBookingErrorMessage(new Error('Network Error'))).toMatch(/ligação/)
  })
})
