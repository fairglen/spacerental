import { describe, it, expect } from 'vitest'
import { parseSlotParams, slotReturnPath } from '@/lib/bookingDeepLink'
import { paymentOptions } from '@/lib/paymentSplit'

// K02: the slot that rides in the query across a pack purchase.
describe('parseSlotParams', () => {
  it('accepts two whole-hour instants in order, at most a day apart', () => {
    const slot = parseSlotParams('2030-08-12T09:00:00Z', '2030-08-12T11:00:00.000Z')
    expect(slot?.start.toISOString()).toBe('2030-08-12T09:00:00.000Z')
    expect(slot?.end.toISOString()).toBe('2030-08-12T11:00:00.000Z')
  })

  it.each([
    ['missing end', '2030-08-12T09:00:00Z', null],
    ['empty', '', ''],
    ['not a date', 'now', 'later'],
    ['minutes', '2030-08-12T09:30:00Z', '2030-08-12T11:00:00Z'],
    ['seconds', '2030-08-12T09:00:00Z', '2030-08-12T11:00:05Z'],
    ['end before start', '2030-08-12T11:00:00Z', '2030-08-12T09:00:00Z'],
    ['end equals start', '2030-08-12T09:00:00Z', '2030-08-12T09:00:00Z'],
    ['longer than a day', '2030-08-12T09:00:00Z', '2030-08-13T10:00:00Z'],
  ])('rejects %s', (_label, s, e) => {
    expect(parseSlotParams(s, e)).toBeNull()
  })
})

describe('slotReturnPath', () => {
  it('builds the relative path the backend accepts as return_to', () => {
    const path = slotReturnPath('/spaces/s-1', 'r-1', new Date('2030-08-12T09:00:00Z'), new Date('2030-08-12T11:00:00Z'))
    expect(path).toBe('/spaces/s-1?room=r-1&start=2030-08-12T09%3A00%3A00.000Z&end=2030-08-12T11%3A00%3A00.000Z')
    expect(path.startsWith('/')).toBe(true)
    expect(path).not.toMatch(/^\/\/|:\/\/|#/)
  })
})

// K02: the order the modal lists its payment choices in.
describe('paymentOptions', () => {
  const partial = { kind: 'partial' as const, packHours: 1, paidHours: 2, hoursLeftAfter: 0, packsUsed: 1 }
  const full = { kind: 'full' as const, packHours: 3, paidHours: 0, hoursLeftAfter: 2, packsUsed: 1 }

  it('an empty bank that never bought a pack: the pack first, then the hourly price', () => {
    expect(paymentOptions({ kind: 'none' }, false)).toEqual(['buy', 'hourly'])
  })
  it('an empty bank that bought before: the hourly price first, then the pack', () => {
    expect(paymentOptions({ kind: 'none' }, true)).toEqual(['hourly', 'buy'])
  })
  it('a partial bank: use the hours, pay everything, buy a pack — whatever the history', () => {
    expect(paymentOptions(partial, false)).toEqual(['pack', 'hourly', 'buy'])
    expect(paymentOptions(partial, true)).toEqual(['pack', 'hourly', 'buy'])
  })
  it('a bank that covers the block offers no pack to buy', () => {
    expect(paymentOptions(full, true)).toEqual(['pack', 'hourly'])
  })
})
