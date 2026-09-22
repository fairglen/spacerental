import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
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

// "Onde estamos" (V06): address, directions, contact, hours and a map that
// loads only when asked — one block for the landing page and the rooms page.
describe('WhereWeAre', () => {
  describe('the words', () => {
    it('is a labelled section with the space name, the street, then postcode and city', () => {
      render(<WhereWeAre space={full} rooms={rooms} />)
      const section = screen.getByRole('region', { name: /onde estamos/i })
      expect(within(section).getByText('Espaço Calmo')).toBeVisible()
      const address = within(section).getByRole('group', { name: /morada/i })
      expect(address).toHaveTextContent('R. 12 de Julho de 1997 5, Loja 1')
      expect(address).toHaveTextContent('2745-841 Queluz')
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
    it('makes no third-party request until asked, and the placeholder holds the address and the button at the map\'s size', () => {
      const { container } = render(<WhereWeAre space={full} rooms={rooms} />)
      expect(container.querySelector('iframe')).toBeNull()
      expect(container.querySelector('img')).toBeNull()
      const button = screen.getByRole('button', { name: /ver mapa/i })
      expect(button).toBeVisible()
      const placeholder = button.parentElement!
      expect(placeholder).toHaveTextContent('R. 12 de Julho de 1997 5, Loja 1 · 2745-841 Queluz')
      expect(screen.getByTestId('map-frame').className).toMatch(/min-h-\[280px\]/)
    })

    it('mounts a lazy, referrer-free, titled OpenStreetMap frame centred on the point, then offers the full map', () => {
      const { container } = render(<WhereWeAre space={full} rooms={rooms} />)
      fireEvent.click(screen.getByRole('button', { name: /ver mapa/i }))
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
      expect(screen.queryByRole('button', { name: /ver mapa/i })).toBeNull()
      expect(screen.getByRole('link', { name: /abrir o mapa completo/i })).toHaveAttribute('href', expect.stringContaining('openstreetmap.org/?mlat=38.755723'))
    })

    it('has no map column without coordinates, and searches by address instead', () => {
      const { container } = render(<WhereWeAre space={{ ...full, latitude: null, longitude: null }} rooms={rooms} />)
      expect(screen.queryByRole('button', { name: /ver mapa/i })).toBeNull()
      expect(container.querySelector('iframe')).toBeNull()
      const href = screen.getByRole('link', { name: /como chegar/i }).getAttribute('href')!
      expect(href.startsWith('https://www.google.com/maps/search/?api=1&query=')).toBe(true)
      expect(new URL(href).searchParams.get('query')).toContain('2745-841 Queluz')
    })

    it('treats one coordinate alone as no coordinates', () => {
      render(<WhereWeAre space={{ ...full, longitude: null }} rooms={rooms} />)
      expect(screen.queryByRole('button', { name: /ver mapa/i })).toBeNull()
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
