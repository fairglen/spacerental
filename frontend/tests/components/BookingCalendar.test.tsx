import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
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
const PAST_STYLE = '#fafafa'

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
      slot('2030-08-12T09:00:00Z', '2030-08-12T10:00:00Z'),
      slot('2030-08-12T10:00:00Z', '2030-08-12T11:00:00Z'),
      slot('2030-08-12T11:00:00Z', '2030-08-12T12:00:00Z'),
      slot('2030-08-12T12:00:00Z', '2030-08-12T13:00:00Z'),
    ])

    select('2030-08-12T09:00:00Z', '2030-08-12T12:00:00Z')

    expect(onSlotSelect).toHaveBeenCalledTimes(1)
    expect(onSlotSelect).toHaveBeenCalledWith(
      parseISO('2030-08-12T09:00:00Z'),
      parseISO('2030-08-12T12:00:00Z'),
    )
  })

  it('still books a single hour on a plain click (B1, unchanged behaviour)', async () => {
    const { onSlotSelect } = await renderCalendar([
      slot('2030-08-12T09:00:00Z', '2030-08-12T10:00:00Z'),
      slot('2030-08-12T10:00:00Z', '2030-08-12T11:00:00Z'),
    ])

    select('2030-08-12T09:00:00Z', '2030-08-12T10:00:00Z', 'click')

    expect(onSlotSelect).toHaveBeenCalledWith(
      parseISO('2030-08-12T09:00:00Z'),
      parseISO('2030-08-12T10:00:00Z'),
    )
  })

  it('rejects a range covering a taken hour and names it (B1)', async () => {
    const taken = parseISO('2030-08-12T10:00:00Z')
    const { onSlotSelect } = await renderCalendar([
      slot('2030-08-12T09:00:00Z', '2030-08-12T10:00:00Z'),
      slot('2030-08-12T10:00:00Z', '2030-08-12T11:00:00Z', false),
      slot('2030-08-12T11:00:00Z', '2030-08-12T12:00:00Z'),
    ])

    select('2030-08-12T09:00:00Z', '2030-08-12T12:00:00Z')

    expect(onSlotSelect).not.toHaveBeenCalled()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(format(taken, 'HH:mm'))
  })

  it('rejects a range that spans a closed window between two open ones', async () => {
    const { onSlotSelect } = await renderCalendar([
      slot('2030-08-12T09:00:00Z', '2030-08-12T10:00:00Z'),
      // 10:00–14:00 is outside every availability rule for this room.
      slot('2030-08-12T14:00:00Z', '2030-08-12T15:00:00Z'),
    ])

    select('2030-08-12T09:00:00Z', '2030-08-12T15:00:00Z')

    expect(onSlotSelect).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('clears a previous rejection once a valid range is selected', async () => {
    const { onSlotSelect } = await renderCalendar([
      slot('2030-08-12T09:00:00Z', '2030-08-12T10:00:00Z'),
      slot('2030-08-12T10:00:00Z', '2030-08-12T11:00:00Z', false),
    ])

    select('2030-08-12T09:00:00Z', '2030-08-12T11:00:00Z')
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    select('2030-08-12T09:00:00Z', '2030-08-12T10:00:00Z', 'click')
    expect(onSlotSelect).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  // ── T7: slot lookup must not depend on exact-millisecond equality ────────
  // Slots arrive as UTC instants; the grid the user drags on is in their local
  // zone. On a non-integer-hour offset (UTC+05:30 and friends) a grid line never
  // coincides with a slot boundary, and equality matching finds nothing at all.

  it('matches slots that do not start exactly on the dragged boundary (T7)', async () => {
    const { onSlotSelect } = await renderCalendar([
      slot('2030-08-12T08:30:00Z', '2030-08-12T09:30:00Z'),
      slot('2030-08-12T09:30:00Z', '2030-08-12T10:30:00Z'),
      slot('2030-08-12T10:30:00Z', '2030-08-12T11:30:00Z'),
    ])

    select('2030-08-12T09:00:00Z', '2030-08-12T11:00:00Z')

    expect(onSlotSelect).toHaveBeenCalledWith(
      parseISO('2030-08-12T08:30:00Z'),
      parseISO('2030-08-12T11:30:00Z'),
    )
  })

  it('tints a grid cell from the slot containing it, not the one starting on it (T7)', async () => {
    await renderCalendar([
      slot('2030-08-12T08:30:00Z', '2030-08-12T09:30:00Z'),
      slot('2030-08-12T09:30:00Z', '2030-08-12T10:30:00Z', false),
    ])

    const free = calendar!.slotPropGetter(parseISO('2030-08-12T09:00:00Z'))
    const busy = calendar!.slotPropGetter(parseISO('2030-08-12T10:00:00Z'))

    expect(free.style?.backgroundColor).toBe(AVAILABLE_STYLE)
    expect(busy.style?.backgroundColor).toBe(BUSY_STYLE)
  })
})

describe('BookingCalendar past hours (B24)', () => {
  // Yesterday at 10:00 in the browser's zone: unavailable per the API, but
  // because it has gone by, not because someone booked it.
  const yesterday = new Date(Date.now() - 86_400_000)
  yesterday.setHours(10, 0, 0, 0)
  const pastStart = yesterday.toISOString()
  const pastEnd = new Date(yesterday.getTime() + 3_600_000).toISOString()

  it('styles a past slot as disabled, not busy, and shows no Ocupado chip', async () => {
    await renderCalendar([
      slot(pastStart, pastEnd, false),
      slot('2030-08-12T09:00:00Z', '2030-08-12T10:00:00Z'),
    ])
    expect(calendar!.slotPropGetter(parseISO(pastStart)).style?.backgroundColor).toBe(PAST_STYLE)
    expect(calendar!.slotPropGetter(parseISO(pastStart)).style?.cursor).toBe('not-allowed')
    expect(calendar!.events).toHaveLength(0)
  })

  it('still shows Ocupado for a genuinely taken future slot', async () => {
    await renderCalendar([
      slot('2030-08-12T09:00:00Z', '2030-08-12T10:00:00Z', false),
    ])
    expect(calendar!.slotPropGetter(parseISO('2030-08-12T09:00:00Z')).style?.backgroundColor).toBe(BUSY_STYLE)
    expect(calendar!.events).toHaveLength(1)
    expect(calendar!.events[0].title).toBe('Ocupado')
  })

  it('refuses a past selection with a "já passou" message rather than "reservada"', async () => {
    const { onSlotSelect } = await renderCalendar([slot(pastStart, pastEnd, false)])
    select(pastStart, pastEnd)
    expect(onSlotSelect).not.toHaveBeenCalled()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/já passou/)
    expect(alert).not.toHaveTextContent(/reservada/)
  })
})

describe('BookingCalendar visible states (B26)', () => {
  function renderRaw() {
    const onSlotSelect = vi.fn()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <BookingCalendar room={room} onSlotSelect={onSlotSelect} />
      </QueryClientProvider>,
    )
    return { onSlotSelect }
  }

  it('says it is loading while availability is in flight', async () => {
    vi.mocked(spacesApi.getAvailability).mockReturnValue(new Promise(() => {}))
    renderRaw()
    expect(await screen.findByRole('status')).toHaveTextContent(/a carregar/i)
  })

  it('shows an error with a retry that refetches', async () => {
    vi.mocked(spacesApi.getAvailability).mockRejectedValueOnce(new Error('boom'))
    renderRaw()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/não foi possível/i)
    vi.mocked(spacesApi.getAvailability).mockResolvedValue([
      slot('2030-08-12T09:00:00Z', '2030-08-12T10:00:00Z'),
    ])
    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(spacesApi.getAvailability).toHaveBeenCalledTimes(2)
  })

  it('labels a day with no opening hours as closed', async () => {
    vi.mocked(spacesApi.getAvailability).mockResolvedValue([])
    renderRaw()
    expect(await screen.findByText(/fechado neste dia/i)).toBeVisible()
    expect(screen.queryByText(/a carregar/i)).toBeNull()
  })

  it('tells the customer when a selection falls outside opening hours', async () => {
    const { onSlotSelect } = await renderCalendar([
      slot('2030-08-12T09:00:00Z', '2030-08-12T10:00:00Z'),
    ])
    select('2030-08-12T06:00:00Z', '2030-08-12T07:00:00Z')
    expect(onSlotSelect).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent(/horário de funcionamento/i)
  })
})

describe('BookingCalendar toolbar label (B33d)', () => {
  it('formats the day header as a full Portuguese date', async () => {
    await renderCalendar([slot('2030-08-12T09:00:00Z', '2030-08-12T10:00:00Z')])
    const props = calendar as unknown as {
      formats?: { dayHeaderFormat?: (date: Date, culture: string, localizer: { format: (d: Date, f: string, c?: string) => string }) => string }
    }
    const ptLocalizer = { format: (d: Date, f: string) => format(d, f, { locale: pt }) }
    expect(props.formats?.dayHeaderFormat?.(new Date(2026, 8, 18), 'pt', ptLocalizer)).toBe('sexta-feira, 18 de setembro')
  })
})
