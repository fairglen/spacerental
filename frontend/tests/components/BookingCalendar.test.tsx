import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { addDays, format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import type { ToolbarProps } from 'react-big-calendar'
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
  view: string
  views: string[]
  onView: (view: string) => void
  onNavigate: (date: Date) => void
  onDrillDown?: unknown
  selectable: boolean
  messages: Record<string, unknown>
  formats: Record<string, unknown>
  components: { toolbar: React.ComponentType<ToolbarProps> }
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
function slot(start: string, end: string, available = true, reason: AvailabilitySlot['reason'] = null): AvailabilitySlot {
  return { start, end, available, reason: available ? null : reason }
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

/** The browser's width, as both of the things a component may ask. */
function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query)
    return {
      matches: min ? width >= Number(min[1]) : false,
      media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }
  })
}

beforeEach(() => {
  calendar = null
  vi.clearAllMocks()
  window.sessionStorage.clear()
  // A phone: the day view, which is what every test below was written against.
  setViewportWidth(390)
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

describe('BookingCalendar visible range follows the slots (B34)', () => {
  type RangeProps = { min?: Date; max?: Date }
  const hoursOf = (d?: Date) => (d ? d.getHours() + d.getMinutes() / 60 : undefined)

  // Local-time slots so the expectation does not depend on the test machine's zone.
  function localSlot(day: Date, fromHour: number, toHour: number, available = true): AvailabilitySlot {
    const start = new Date(day); start.setHours(fromHour, 0, 0, 0)
    const end = new Date(day); end.setHours(toHour, 0, 0, 0)
    return { start: start.toISOString(), end: end.toISOString(), available }
  }
  const day = new Date(2030, 7, 12) // a Monday, far in the future

  it('pads one hour around the earliest and latest returned slot', async () => {
    await renderCalendar([localSlot(day, 9, 10), localSlot(day, 20, 21)])
    const props = calendar as unknown as RangeProps
    expect(hoursOf(props.min)).toBe(8)
    expect(hoursOf(props.max)).toBe(22)
  })

  it('never hides a bookable hour, whatever the operator configured', async () => {
    await renderCalendar([localSlot(day, 6, 7), localSlot(day, 22, 23)])
    const props = calendar as unknown as RangeProps
    expect(hoursOf(props.min)).toBeLessThanOrEqual(6)
    expect(hoursOf(props.max)).toBeGreaterThanOrEqual(23)
  })

  it('clamps to the day and keeps the old window as a fallback with no slots', async () => {
    await renderCalendar([localSlot(day, 0, 1), localSlot(day, 23, 24)])
    const first = calendar as unknown as RangeProps
    expect(hoursOf(first.min)).toBe(0)
    expect(first.max!.getHours() === 23 && first.max!.getMinutes() >= 59).toBe(true)

    calendar = null
    vi.mocked(spacesApi.getAvailability).mockResolvedValue([])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <BookingCalendar room={room} onSlotSelect={vi.fn()} />
      </QueryClientProvider>,
    )
    await screen.findByText(/fechado neste dia/i)
    const fallback = calendar as unknown as RangeProps
    expect(hoursOf(fallback.min)).toBe(8)
    expect(hoursOf(fallback.max)).toBe(20)
  })
})

describe('BookingCalendar views: hourly booking on a day or a week (C12)', () => {
  const monday = [
    slot('2030-08-12T09:00:00Z', '2030-08-12T10:00:00Z'),
    slot('2030-08-12T10:00:00Z', '2030-08-12T11:00:00Z'),
    slot('2030-08-12T11:00:00Z', '2030-08-12T12:00:00Z'),
  ]

  it('offers the day and the week, and nothing else', async () => {
    await renderCalendar(monday)
    expect(calendar!.views).toEqual(['day', 'week'])
    expect(calendar!.messages).not.toHaveProperty('month')
    expect(calendar!.formats).not.toHaveProperty('monthHeaderFormat')
    // There is no month grid left to drill down from.
    expect(calendar!.onDrillDown).toBeUndefined()
    expect(calendar!.selectable).toBe(true)
  })

  it.each([
    [1024, 'week'],
    [1440, 'week'],
    [1023, 'day'],
    [390, 'day'],
  ])('opens at %ipx on the %s view', async (width, expected) => {
    setViewportWidth(width)
    await renderCalendar(monday)
    expect(calendar!.view).toBe(expected)
  })

  /** Like the API: each date has its own slots. Only the first date asked for has any here. */
  function serveOnce(slots: AvailabilitySlot[]) {
    let servedFor: string | null = null
    vi.mocked(spacesApi.getAvailability).mockImplementation(async (_roomId, date) => {
      servedFor ??= date
      return date === servedFor ? slots : []
    })
  }

  async function renderServingOnce(slots: AvailabilitySlot[]) {
    const onSlotSelect = vi.fn()
    serveOnce(slots)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <BookingCalendar room={room} onSlotSelect={onSlotSelect} />
      </QueryClientProvider>,
    )
    await waitFor(() => {
      expect(calendar).not.toBeNull()
      expect(calendar!.slotPropGetter(parseISO(slots[0].start)).style).toBeDefined()
    })
    return { onSlotSelect }
  }

  const askedDates = () =>
    Array.from(new Set(vi.mocked(spacesApi.getAvailability).mock.calls.map(([, date]) => date))).sort()

  it('asks for a single day on the day view', async () => {
    await renderServingOnce(monday)
    expect(askedDates()).toHaveLength(1)
  })

  it('asks for Monday to Sunday on the week view', async () => {
    setViewportWidth(1440)
    await renderServingOnce(monday)
    const week = askedDates()
    expect(week).toHaveLength(7)
    expect(parseISO(week[0]).getDay()).toBe(1)
    expect(parseISO(week[6]).getDay()).toBe(0)
  })

  it.each([['day', 390], ['week', 1440]])(
    'books one hour on a click and several on a drag, on the %s view',
    async (view, width) => {
      setViewportWidth(width)
      const { onSlotSelect } = await renderServingOnce(monday)
      expect(calendar!.view).toBe(view)

      select('2030-08-12T10:00:00Z', '2030-08-12T11:00:00Z', 'click')
      expect(onSlotSelect).toHaveBeenLastCalledWith(parseISO('2030-08-12T10:00:00Z'), parseISO('2030-08-12T11:00:00Z'))

      select('2030-08-12T09:00:00Z', '2030-08-12T12:00:00Z')
      expect(onSlotSelect).toHaveBeenLastCalledWith(parseISO('2030-08-12T09:00:00Z'), parseISO('2030-08-12T12:00:00Z'))
      expect(onSlotSelect).toHaveBeenCalledTimes(2)
    },
  )

  it('keeps the customer\'s own choice of view for the rest of the session', async () => {
    setViewportWidth(1440)
    await renderCalendar(monday)
    expect(calendar!.view).toBe('week')

    act(() => calendar!.onView('day'))
    expect(calendar!.view).toBe('day')

    // Another room, another mount — and a viewport that would default to week.
    cleanup()
    calendar = null
    await renderCalendar(monday)
    expect(calendar!.view).toBe('day')
  })

  it('lets a phone user keep the week view once they have asked for it', async () => {
    await renderCalendar(monday)
    expect(calendar!.view).toBe('day')
    act(() => calendar!.onView('week'))
    cleanup()
    calendar = null
    await renderCalendar(monday)
    expect(calendar!.view).toBe('week')
  })

  it('ignores a remembered view it no longer offers', async () => {
    window.sessionStorage.setItem('espacohora.calendarView', 'month')
    setViewportWidth(1440)
    await renderCalendar(monday)
    expect(calendar!.view).toBe('week')
  })

  it('still works when session storage is unavailable', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    try {
      setViewportWidth(1440)
      await renderCalendar(monday)
      expect(calendar!.view).toBe('week')
      act(() => calendar!.onView('day'))
      expect(calendar!.view).toBe('day')
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })

  it('names a closed week as a week', async () => {
    setViewportWidth(1440)
    vi.mocked(spacesApi.getAvailability).mockResolvedValue([])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <BookingCalendar room={room} onSlotSelect={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/Fechado nesta semana/)).toBeVisible()
  })
})

describe('BookingCalendar booking window (H01)', () => {
  // The API's verdict, not the browser's clock: a slot the backend marked as
  // past the customer's horizon.
  const far = slot('2030-08-12T09:00:00Z', '2030-08-12T10:00:00Z', false, 'beyond_window')

  it('styles a beyond-window slot like a past one and shows no Ocupado chip', async () => {
    await renderCalendar([far, slot('2030-08-12T10:00:00Z', '2030-08-12T11:00:00Z')])
    expect(calendar!.slotPropGetter(parseISO(far.start)).style?.backgroundColor).toBe(PAST_STYLE)
    expect(calendar!.slotPropGetter(parseISO(far.start)).style?.cursor).toBe('not-allowed')
    expect(calendar!.events).toHaveLength(0)
  })

  it('refuses a selection past the window and names the last open date', async () => {
    const { onSlotSelect } = await renderCalendar([far])
    select(far.start, far.end)
    expect(onSlotSelect).not.toHaveBeenCalled()
    const alert = await screen.findByRole('alert')
    const lastDay = format(addDays(new Date(), 30), "d 'de' MMMM", { locale: pt })
    expect(alert).toHaveTextContent(`abertas até ${lastDay}`)
    expect(alert).not.toHaveTextContent(/reservada|passou/)
  })

  it('always tells the customer until when bookings are open', async () => {
    await renderCalendar([slot('2030-08-12T09:00:00Z', '2030-08-12T10:00:00Z')])
    const lastDay = format(addDays(new Date(), 30), "d 'de' MMMM", { locale: pt })
    expect(screen.getByTestId('booking-window-hint')).toHaveTextContent(`Reservas abertas até ${lastDay}.`)
  })

  it('asks for no day past the window in the week that straddles it, and shows no load error', async () => {
    setViewportWidth(1280) // the week view
    await renderCalendar([slot('2030-08-12T09:00:00Z', '2030-08-12T10:00:00Z')])
    vi.mocked(spacesApi.getAvailability).mockClear()
    // Navigate to the week holding the last open day (today + 30).
    const lastDay = addDays(new Date(), 30)
    act(() => calendar!.onNavigate(lastDay))
    await waitFor(() => expect(spacesApi.getAvailability).toHaveBeenCalled())
    const asked = vi.mocked(spacesApi.getAvailability).mock.calls.map(([, d]) => d)
    const last = format(lastDay, 'yyyy-MM-dd')
    expect(asked.length).toBeGreaterThan(0)
    expect(asked.every((d) => d <= last)).toBe(true)
    expect(asked).toContain(last)
    expect(screen.queryByText(/Não foi possível carregar/)).toBeNull()
  })

  describe('toolbar', () => {
    function renderToolbar(date: Date, view: 'day' | 'week') {
      const onNavigate = vi.fn()
      const onView = vi.fn()
      const Toolbar = calendar!.components.toolbar
      const localizer = { messages: {} } as ToolbarProps['localizer']
      render(<Toolbar date={date} view={view} views={['day', 'week']} label="x" localizer={localizer} onNavigate={onNavigate} onView={onView} />)
      return { onNavigate, onView }
    }

    it('keeps › live while the next day still has open hours', async () => {
      await renderCalendar([slot('2030-08-12T09:00:00Z', '2030-08-12T10:00:00Z')])
      const { onNavigate } = renderToolbar(addDays(new Date(), 28), 'day')
      const next = screen.getByRole('button', { name: '›' })
      expect(next).toBeEnabled()
      fireEvent.click(next)
      expect(onNavigate).toHaveBeenCalledWith('NEXT')
    })

    it('disables › on the last open day, and in the week view once the next week is past it', async () => {
      await renderCalendar([slot('2030-08-12T09:00:00Z', '2030-08-12T10:00:00Z')])
      const { onNavigate } = renderToolbar(addDays(new Date(), 30), 'day')
      const next = screen.getByRole('button', { name: '›' })
      expect(next).toBeDisabled()
      fireEvent.click(next)
      expect(onNavigate).not.toHaveBeenCalled()
      cleanup()
      // ‹, Hoje and the view switch stay usable whatever › does.
      renderToolbar(addDays(new Date(), 30), 'week')
      expect(screen.getByRole('button', { name: '›' })).toBeDisabled()
      expect(screen.getByRole('button', { name: '‹' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Hoje' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Semana' })).toHaveClass('rbc-active')
      expect(screen.getByRole('button', { name: 'Dia' })).not.toHaveClass('rbc-active')
    })
  })
})
