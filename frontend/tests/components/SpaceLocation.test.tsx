import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SpaceLocation } from '@/components/spaces/SpaceLocation'

const full = {
  name: 'Espaço Calmo',
  address: 'R. 12 de Julho de 1997 5, Loja 1',
  postal_code: '2745-841',
  city: 'Queluz',
  latitude: 38.755723,
  longitude: -9.279799,
}

describe('SpaceLocation (C10)', () => {
  describe('with a full location', () => {
    it('shows the street, then postcode and city', () => {
      render(<SpaceLocation space={full} />)
      const address = screen.getByRole('group', { name: /morada/i })
      expect(address).toHaveTextContent('R. 12 de Julho de 1997 5, Loja 1')
      expect(address).toHaveTextContent('2745-841 Queluz')
    })

    it('opens directions to the coordinates in a new tab, without leaking the opener', () => {
      render(<SpaceLocation space={full} />)
      const link = screen.getByRole('link', { name: /como chegar/i })
      expect(link).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=38.755723,-9.279799')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link.getAttribute('rel')).toContain('noopener')
      expect(link.getAttribute('rel')).toContain('noreferrer')
    })

    it('makes no third-party request until the map is asked for', () => {
      const { container } = render(<SpaceLocation space={full} />)
      expect(container.querySelector('iframe')).toBeNull()
      expect(container.querySelector('img')).toBeNull()
      expect(screen.getByRole('button', { name: /ver mapa/i })).toBeVisible()
    })

    it('mounts a lazy, referrer-free, titled OpenStreetMap frame on click', () => {
      const { container } = render(<SpaceLocation space={full} />)
      fireEvent.click(screen.getByRole('button', { name: /ver mapa/i }))
      const frame = container.querySelector('iframe')
      expect(frame).not.toBeNull()
      expect(frame!.getAttribute('src')).toContain('https://www.openstreetmap.org/export/embed.html')
      expect(frame!.getAttribute('src')).toContain('marker=38.755723%2C-9.279799')
      expect(frame).toHaveAttribute('loading', 'lazy')
      expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
      expect(frame!.getAttribute('title')).toMatch(/Espaço Calmo/)
      expect(screen.queryByRole('button', { name: /ver mapa/i })).toBeNull()
    })
  })

  describe('with partial data', () => {
    it('renders only the parts that exist', () => {
      render(<SpaceLocation space={{ ...full, postal_code: null, latitude: null, longitude: null }} />)
      const address = screen.getByRole('group', { name: /morada/i })
      expect(address).toHaveTextContent('Queluz')
      expect(address.textContent).not.toMatch(/null|undefined/)
      expect(address.textContent).not.toMatch(/,\s*$/)
    })

    it('has no map section without coordinates, and searches by address instead', () => {
      const { container } = render(<SpaceLocation space={{ ...full, latitude: null, longitude: null }} />)
      expect(screen.queryByRole('button', { name: /ver mapa/i })).toBeNull()
      expect(container.querySelector('iframe')).toBeNull()
      const href = screen.getByRole('link', { name: /como chegar/i }).getAttribute('href')!
      expect(href.startsWith('https://www.google.com/maps/search/?api=1&query=')).toBe(true)
      expect(new URL(href).searchParams.get('query')).toContain('2745-841 Queluz')
    })

    it('treats one coordinate alone as no coordinates', () => {
      render(<SpaceLocation space={{ ...full, longitude: null }} />)
      expect(screen.queryByRole('button', { name: /ver mapa/i })).toBeNull()
    })
  })

  describe('with no location at all', () => {
    it('renders nothing', () => {
      const { container } = render(<SpaceLocation space={{ name: 'Sem morada' }} />)
      expect(container).toBeEmptyDOMElement()
    })
  })

  it('keeps the map out of the compact variant only when told to', () => {
    render(<SpaceLocation space={full} variant="compact" />)
    expect(screen.getByRole('link', { name: /como chegar/i })).toBeVisible()
    expect(screen.getByRole('button', { name: /ver mapa/i })).toBeVisible()
  })
})
