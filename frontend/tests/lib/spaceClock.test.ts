import { describe, it, expect } from 'vitest'
import { localInputToUtc, utcToWall, wallToUtc } from '@/lib/spaceClock'

// Review on #65: operators' forms speak the space's wall clock, whatever the
// browser's zone. Every case below is independent of the machine's TZ.
describe('spaceClock', () => {
  it('reads a UTC instant on the zone wall clock, winter and summer', () => {
    expect(utcToWall('2026-01-15T09:00:00Z', 'Europe/Lisbon')).toEqual({ date: '2026-01-15', time: '09:00' })
    expect(utcToWall('2026-07-15T09:00:00Z', 'Europe/Lisbon')).toEqual({ date: '2026-07-15', time: '10:00' })
    expect(utcToWall('2026-07-15T02:30:00Z', 'America/Sao_Paulo')).toEqual({ date: '2026-07-14', time: '23:30' })
    expect(utcToWall('2026-07-15T09:00:00Z', 'Asia/Tokyo')).toEqual({ date: '2026-07-15', time: '18:00' })
  })

  it('turns a wall clock back into the right instant, winter and summer', () => {
    expect(wallToUtc('2026-01-15', '09:00', 'Europe/Lisbon')).toBe('2026-01-15T09:00:00.000Z')
    expect(wallToUtc('2026-07-15', '10:00', 'Europe/Lisbon')).toBe('2026-07-15T09:00:00.000Z')
    expect(wallToUtc('2026-07-14', '23:30', 'America/Sao_Paulo')).toBe('2026-07-15T02:30:00.000Z')
    expect(wallToUtc('2026-07-15', '18:00', 'Asia/Tokyo')).toBe('2026-07-15T09:00:00.000Z')
    expect(localInputToUtc('2026-07-15T18:00', 'Asia/Tokyo')).toBe('2026-07-15T09:00:00.000Z')
  })

  it('round-trips either way for an ordinary hour', () => {
    for (const zone of ['Europe/Lisbon', 'America/Sao_Paulo', 'Australia/Sydney', 'UTC']) {
      const iso = '2026-10-20T14:00:00.000Z'
      const wall = utcToWall(iso, zone)
      expect(wallToUtc(wall.date, wall.time, zone)).toBe(iso)
    }
  })

  it('a wall time that happens twice (clocks back) is its first occurrence', () => {
    // Lisbon, 2026-10-25: 02:00 WEST → 01:00 WET; 01:30 happens at 00:30Z and 01:30Z.
    expect(wallToUtc('2026-10-25', '01:30', 'Europe/Lisbon')).toBe('2026-10-25T00:30:00.000Z')
  })

  it('a wall time that never happens (clocks forward) lands after the gap', () => {
    // Lisbon, 2026-03-29: 01:00 WET → 02:00 WEST; 01:30 does not exist.
    expect(wallToUtc('2026-03-29', '01:30', 'Europe/Lisbon')).toBe('2026-03-29T01:30:00.000Z')
    expect(utcToWall('2026-03-29T01:30:00Z', 'Europe/Lisbon')).toEqual({ date: '2026-03-29', time: '02:30' })
  })
})
