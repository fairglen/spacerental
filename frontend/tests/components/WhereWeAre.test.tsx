import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { WhereWeAre } from '@/components/spaces/WhereWeAre'
import type { OpeningWindow } from '@/types'

const full = {
  name: 'Espaço Calmo',
  address: 'R. 12 de Julho de 1997 5, Loja 1',
  postal_code: '2745-841',
  city: 'Queluz',
  latitude: 38.755723,
  longitude: -9.279799,
}
const w = (day: number, open: string, close: string): OpeningWindow => ({ day_of_week: day, open_time: open, close_time: close })
const allWeek = (open: string, close: string) => Array.from({ length: 7 }, (_, d) => w(d, open, close))
const rooms = [{ availability_rules: allWeek('08:00:00', '22:00:00') }]

// "Onde estamos" (V06, reworked in L04): hours, email, address and the
// directions button, one line each with its icon and no labels or divider;
// the map on the right, loaded on render — one block for the landing page
// and the rooms page.
describe('WhereWeAre', () => {
  describe('the words', () => {
    it('is a labelled section with the street, then postcode and city — and no venue name line (M03)', () => {
      const { container } = render(<WhereWeAre space={full} rooms={rooms} />)
      const section = screen.getByRole('region', { name: /onde estamos/i })
      // The name is not visible text any more; it survives only in the map frame's title.
      expect(within(section).queryByText('Espaço Calmo')).toBeNull()
      expect(container.querySelector('iframe')!.getAttribute('title')).toMatch(/Espaço Calmo/)
      // The heading is followed directly by the lines list.
      const heading = within(section).getByRole('heading', { name: /onde estamos/i })
      expect(heading.nextElementSibling).toBe(screen.getByTestId('where-lines'))
      const address = within(section).getByRole('group', { name: /morada/i })
      expect(address).toHaveTextContent('R. 12 de Julho de 1997 5, Loja 1')
      expect(address).toHaveTextContent('2745-841 Queluz')
      // Two lines: the street, then postcode and city.
      expect(within(address).getByText('R. 12 de Julho de 1997 5, Loja 1').className).toContain('block')
      expect(within(address).getByText('2745-841 Queluz').className).toContain('block')
    })

    it('lists hours, then email, then the address, each with an icon, and the directions button right under the address (L04)', () => {
      render(<WhereWeAre space={full} rooms={rooms} />)
      const items = Array.from(screen.getByTestId('where-lines').querySelectorAll(':scope > li'))
      expect(items).toHaveLength(3)
      expect(items[0]).toHaveTextContent('Todos os dias 08:00–22:00')
      expect(items[1]).toHaveTextContent('geral@flowspace.pt')
      expect(items[2]).toHaveTextContent('2745-841 Queluz')
      for (const item of items) expect(item.querySelector('svg')).not.toBeNull()
      // No divider, no uppercase labels ("Contacto", "Horário") any more.
      const section = screen.getByRole('region', { name: /onde estamos/i })
      expect(section.querySelector('hr')).toBeNull()
      expect(within(section).queryByRole('heading', { level: 3 })).toBeNull()
      expect(within(section).queryByText(/^(Contacto|Horário)$/)).toBeNull()
      const directions = screen.getByRole('link', { name: /como chegar/i })
      expect(items[2].compareDocumentPosition(directions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(directions.compareDocumentPosition(screen.getByTestId('map-frame')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('opens directions to the coordinates in a new tab, without leaking the opener', () => {
      render(<WhereWeAre space={full} rooms={rooms} />)
      const link = screen.getByRole('link', { name: /como chegar/i })
      expect(link).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=38.755723,-9.279799')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link.getAttribute('rel')).toContain('noopener')
      expect(link.getAttribute('rel')).toContain('noreferrer')
    })

    it('lists the one contact address as a mailto and no phone line', () => {
      render(<WhereWeAre space={full} rooms={rooms} />)
      expect(screen.getByRole('link', { name: 'geral@flowspace.pt' })).toHaveAttribute('href', expect.stringMatching(/^mailto:geral@flowspace\.pt/))
      expect(screen.queryByRole('link', { name: /\+?\d[\d ]{6,}/ })).toBeNull()
      expect(document.querySelector('a[href^="tel:"]')).toBeNull()
    })

    it('renders the phone line only when a number is configured', async () => {
      vi.resetModules()
      vi.stubEnv('NEXT_PUBLIC_CONTACT_PHONE', '+351 210 000 000')
      const { WhereWeAre: WithPhone } = await import('@/components/spaces/WhereWeAre')
      render(<WithPhone space={full} rooms={rooms} />)
      expect(screen.getByRole('link', { name: '+351 210 000 000' })).toHaveAttribute('href', 'tel:+351210000000')
      vi.unstubAllEnvs()
      vi.resetModules()
    })
  })

  describe('the hours', () => {
    afterEach(() => vi.useRealTimers())

    it('every day the same → "Todos os dias 08:00–22:00"', () => {
      vi.useFakeTimers({ now: new Date('2026-01-15T12:00:00Z') })
      render(<WhereWeAre space={full} rooms={rooms} />)
      expect(screen.getByTestId('opening-hours')).toHaveTextContent('Todos os dias 08:00–22:00')
      expect(screen.queryByText(/por sala/i)).toBeNull()
    })

    it('Mon–Fri, a different Saturday and a closed Sunday → ranges and "Encerrado"', () => {
      vi.useFakeTimers({ now: new Date('2026-01-15T12:00:00Z') })
      const rules = [...[0, 1, 2, 3, 4].map((d) => w(d, '08:00:00', '20:00:00')), w(5, '09:00:00', '13:00:00')]
      render(<WhereWeAre space={full} rooms={[{ availability_rules: rules }]} />)
      const items = within(screen.getByTestId('opening-hours')).getAllByRole('listitem').map((li) => li.textContent?.trim())
      expect(items).toEqual(['Seg–Sex 08:00–20:00', 'Sáb 09:00–13:00', 'Dom Encerrado'])
    })

    it('rooms with different hours → the union and a note to check the calendar', () => {
      vi.useFakeTimers({ now: new Date('2026-01-15T12:00:00Z') })
      render(<WhereWeAre space={full} rooms={[{ availability_rules: allWeek('08:00:00', '20:00:00') }, { availability_rules: allWeek('10:00:00', '22:00:00') }]} />)
      expect(screen.getByTestId('opening-hours')).toHaveTextContent('Todos os dias 08:00–22:00')
      expect(screen.getByText(/Horário por sala no calendário/)).toBeVisible()
    })

    it('a closed day among open ones says "Encerrado"', () => {
      vi.useFakeTimers({ now: new Date('2026-01-15T12:00:00Z') })
      render(<WhereWeAre space={full} rooms={[{ availability_rules: [0, 1, 2, 3, 4, 5].map((d) => w(d, '08:00:00', '22:00:00')) }]} />)
      expect(screen.getByTestId('opening-hours')).toHaveTextContent('Seg–Sáb 08:00–22:00')
      expect(screen.getByTestId('opening-hours')).toHaveTextContent('Dom Encerrado')
    })
  })

  describe('the map', () => {
    it('is on the page from the first render: no "Ver mapa" step, no placeholder, no privacy sentence (L04)', () => {
      const { container } = render(<WhereWeAre space={full} rooms={rooms} />)
      expect(container.querySelector('iframe')).not.toBeNull()
      expect(screen.queryByRole('button', { name: /ver mapa/i })).toBeNull()
      expect(screen.queryByText(/só é carregado quando o pedir/i)).toBeNull()
      // 16:10 with a floor of 240px on a phone; the column's height from md.
      const frame = screen.getByTestId('map-frame')
      expect(frame.className).toMatch(/aspect-\[16\/10\]/)
      expect(frame.className).toMatch(/min-h-\[240px\]/)
      expect(frame.className).toMatch(/md:min-h-\[280px\]/)
    })

    it('is a lazy, referrer-free, titled OpenStreetMap frame centred on the point, with the full map offered under it', () => {
      const { container } = render(<WhereWeAre space={full} rooms={rooms} />)
      const frame = container.querySelector('iframe')
      expect(frame).not.toBeNull()
      const src = new URL(frame!.getAttribute('src')!)
      expect(src.origin + src.pathname).toBe('https://www.openstreetmap.org/export/embed.html')
      expect(src.searchParams.get('marker')).toBe('38.755723,-9.279799')
      const [west, south, east, north] = src.searchParams.get('bbox')!.split(',').map(Number)
      expect((west + east) / 2).toBeCloseTo(-9.279799, 6)
      expect((south + north) / 2).toBeCloseTo(38.755723, 6)
      expect(frame).toHaveAttribute('loading', 'lazy')
      expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
      expect(frame!.getAttribute('title')).toMatch(/Espaço Calmo/)
      expect(screen.getByRole('link', { name: /abrir o mapa completo/i })).toHaveAttribute('href', expect.stringContaining('openstreetmap.org/?mlat=38.755723'))
    })

    it('has no map column without coordinates, and searches by address instead', () => {
      const { container } = render(<WhereWeAre space={{ ...full, latitude: null, longitude: null }} rooms={rooms} />)
      expect(screen.queryByTestId('map-frame')).toBeNull()
      expect(container.querySelector('iframe')).toBeNull()
      const href = screen.getByRole('link', { name: /como chegar/i }).getAttribute('href')!
      expect(href.startsWith('https://www.google.com/maps/search/?api=1&query=')).toBe(true)
      expect(new URL(href).searchParams.get('query')).toContain('2745-841 Queluz')
    })

    it('treats one coordinate alone as no coordinates', () => {
      const { container } = render(<WhereWeAre space={{ ...full, longitude: null }} rooms={rooms} />)
      expect(container.querySelector('iframe')).toBeNull()
    })
  })

  describe('with partial or no location', () => {
    it('renders only the parts that exist', () => {
      render(<WhereWeAre space={{ ...full, postal_code: null, latitude: null, longitude: null }} rooms={rooms} />)
      const address = screen.getByRole('group', { name: /morada/i })
      expect(address).toHaveTextContent('Queluz')
      expect(address.textContent).not.toMatch(/null|undefined/)
      expect(address.textContent).not.toMatch(/,\s*$/)
    })

    it('renders nothing at all without a location', () => {
      const { container } = render(<WhereWeAre space={{ name: 'Sem morada' }} rooms={rooms} />)
      expect(container).toBeEmptyDOMElement()
    })
  })
})
