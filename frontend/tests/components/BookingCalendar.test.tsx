import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { BookingCalendar } from '@/components/booking/BookingCalendar'
import { spacesApi } from '@/lib/api'
import type { AvailabilitySlot, Room } from '@/types'

// react-big-calendar computes selections from real element geometry, which jsdom
// does not provide. The component's own contract is the selection payload it
// receives, so we capture the props it passes to <Calendar> and drive
// onSelectSlot / slotPropGetter directly — the same payloads rbc produces from a
// drag (start .. exclusive end) and from a click (one step).
type SelectSlotPayload = {
  start: Date
  end: Date
  slots: Date[]
  action: 'select' | 'click' | 'doubleClick'
}
type CalendarStyle = { style?: Record<string, string> }
type CapturedCalendarProps = {
  onSelectSlot: (payload: SelectSlotPayload) => void
  slotPropGetter: (date: Date) => CalendarStyle
  events: { start: Date; end: Date; title: string }[]
}

let calendar: CapturedCalendarProps | null = null

vi.mock('react-big-calendar', () => ({
  dateFnsLocalizer: () => ({}),
  Calendar: (props: CapturedCalendarProps) => {
    calendar = props
    return <div data-testid="rbc-calendar" />
  },
}))

vi.mock('@/lib/api', () => ({
  spacesApi: { getAvailability: vi.fn() },
}))

const room: Room = {
  id: 'room-1',
  space_id: 'space-1',
  org_id: 'org-1',
  name: 'Sala Calma',
  description: '',
  capacity: 6,
  hourly_rate: 11,
  images: [],
  amenities: [],
  color: '#A8D5BA',
  is_active: true,
}

/** Availability as the backend serves it: UTC instants, one row per hour. */
function slot(start: string, end: string, available = true): AvailabilitySlot {
  return { start, end, available }
}

const AVAILABLE_STYLE = '#f0faf5'
const BUSY_STYLE = '#f3f4f6'

async function renderCalendar(slots: AvailabilitySlot[]) {
  const onSlotSelect = vi.fn()
  vi.mocked(spacesApi.getAvailability).mockResolvedValue(slots)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <BookingCalendar room={room} onSlotSelect={onSlotSelect} />
    </QueryClientProvider>,
  )
  // Wait for the availability query to land before driving a selection.
  await waitFor(() => {
    expect(calendar).not.toBeNull()
    expect(calendar!.slotPropGetter(parseISO(slots[0].start)).style).toBeDefined()
  })
  return { onSlotSelect }
}

function select(start: string, end: string, action: SelectSlotPayload['action'] = 'select') {
  act(() => {
    calendar!.onSelectSlot({
      start: parseISO(start),
      end: parseISO(end),
      slots: [],
      action,
    })
  })
}

beforeEach(() => {
  calendar = null
  vi.clearAllMocks()
})

describe('BookingCalendar selection', () => {
  it('books the whole dragged range, not just the first hour (B1)', async () => {
    const { onSlotSelect } = await renderCalendar([
      slot('2026-08-10T09:00:00Z', '2026-08-10T10:00:00Z'),
      slot('2026-08-10T10:00:00Z', '2026-08-10T11:00:00Z'),
      slot('2026-08-10T11:00:00Z', '2026-08-10T12:00:00Z'),
      slot('2026-08-10T12:00:00Z', '2026-08-10T13:00:00Z'),
    ])

    select('2026-08-10T09:00:00Z', '2026-08-10T12:00:00Z')

    expect(onSlotSelect).toHaveBeenCalledTimes(1)
    expect(onSlotSelect).toHaveBeenCalledWith(
      parseISO('2026-08-10T09:00:00Z'),
      parseISO('2026-08-10T12:00:00Z'),
    )
  })

  it('still books a single hour on a plain click (B1, unchanged behaviour)', async () => {
    const { onSlotSelect } = await renderCalendar([
      slot('2026-08-10T09:00:00Z', '2026-08-10T10:00:00Z'),
      slot('2026-08-10T10:00:00Z', '2026-08-10T11:00:00Z'),
    ])

    select('2026-08-10T09:00:00Z', '2026-08-10T10:00:00Z', 'click')

    expect(onSlotSelect).toHaveBeenCalledWith(
      parseISO('2026-08-10T09:00:00Z'),
      parseISO('2026-08-10T10:00:00Z'),
    )
  })

  it('rejects a range covering a taken hour and names it (B1)', async () => {
    const taken = parseISO('2026-08-10T10:00:00Z')
    const { onSlotSelect } = await renderCalendar([
      slot('2026-08-10T09:00:00Z', '2026-08-10T10:00:00Z'),
      slot('2026-08-10T10:00:00Z', '2026-08-10T11:00:00Z', false),
      slot('2026-08-10T11:00:00Z', '2026-08-10T12:00:00Z'),
    ])

    select('2026-08-10T09:00:00Z', '2026-08-10T12:00:00Z')

    expect(onSlotSelect).not.toHaveBeenCalled()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(format(taken, 'HH:mm'))
  })

  it('rejects a range that spans a closed window between two open ones', async () => {
    const { onSlotSelect } = await renderCalendar([
      slot('2026-08-10T09:00:00Z', '2026-08-10T10:00:00Z'),
      // 10:00–14:00 is outside every availability rule for this room.
      slot('2026-08-10T14:00:00Z', '2026-08-10T15:00:00Z'),
    ])

    select('2026-08-10T09:00:00Z', '2026-08-10T15:00:00Z')

    expect(onSlotSelect).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('clears a previous rejection once a valid range is selected', async () => {
    const { onSlotSelect } = await renderCalendar([
      slot('2026-08-10T09:00:00Z', '2026-08-10T10:00:00Z'),
      slot('2026-08-10T10:00:00Z', '2026-08-10T11:00:00Z', false),
    ])

    select('2026-08-10T09:00:00Z', '2026-08-10T11:00:00Z')
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    select('2026-08-10T09:00:00Z', '2026-08-10T10:00:00Z', 'click')
    expect(onSlotSelect).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  // ── T7: slot lookup must not depend on exact-millisecond equality ────────
  // Slots arrive as UTC instants; the grid the user drags on is in their local
  // zone. On a non-integer-hour offset (UTC+05:30 and friends) a grid line never
  // coincides with a slot boundary, and equality matching finds nothing at all.

  it('matches slots that do not start exactly on the dragged boundary (T7)', async () => {
    const { onSlotSelect } = await renderCalendar([
      slot('2026-08-10T08:30:00Z', '2026-08-10T09:30:00Z'),
      slot('2026-08-10T09:30:00Z', '2026-08-10T10:30:00Z'),
      slot('2026-08-10T10:30:00Z', '2026-08-10T11:30:00Z'),
    ])

    select('2026-08-10T09:00:00Z', '2026-08-10T11:00:00Z')

    expect(onSlotSelect).toHaveBeenCalledWith(
      parseISO('2026-08-10T08:30:00Z'),
      parseISO('2026-08-10T11:30:00Z'),
    )
  })

  it('tints a grid cell from the slot containing it, not the one starting on it (T7)', async () => {
    await renderCalendar([
      slot('2026-08-10T08:30:00Z', '2026-08-10T09:30:00Z'),
      slot('2026-08-10T09:30:00Z', '2026-08-10T10:30:00Z', false),
    ])

    const free = calendar!.slotPropGetter(parseISO('2026-08-10T09:00:00Z'))
    const busy = calendar!.slotPropGetter(parseISO('2026-08-10T10:00:00Z'))

    expect(free.style?.backgroundColor).toBe(AVAILABLE_STYLE)
    expect(busy.style?.backgroundColor).toBe(BUSY_STYLE)
  })
})
