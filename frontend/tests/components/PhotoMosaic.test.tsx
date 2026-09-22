import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { PhotoMosaic } from '@/components/spaces/PhotoMosaic'
import type { Photo } from '@/types'

const photos = (n: number): Photo[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`, url: `http://api/media/${i + 1}.webp`, thumb_url: `http://api/media/${i + 1}_thumb.webp`,
    width: 1600, height: 1200,
  }))

const placeholder = <div data-testid="placeholder">🛋️</div>

if (typeof window.PointerEvent === 'undefined') {
  class PointerEventShim extends MouseEvent {}
  Object.defineProperty(window, 'PointerEvent', { value: PointerEventShim, configurable: true })
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})

const mosaic = () => screen.getByTestId('photo-mosaic')
const region = () => screen.getByRole('region', { name: 'Sala Calma — fotografias' })

// V01: the selected room's photos as an Airbnb-style mosaic on wide screens
// (a carousel below 1024px, CSS-toggled), with a full-screen gallery.
describe('PhotoMosaic — layout by count', () => {
  it('zero: the placeholder it was given, no region, no gallery button', () => {
    render(<PhotoMosaic photos={[]} label="Sala Calma" placeholder={placeholder} />)
    expect(screen.getByTestId('placeholder')).toBeInTheDocument()
    expect(screen.queryByRole('region')).toBeNull()
    expect(screen.queryByRole('button', { name: /Mostrar todas as fotos/ })).toBeNull()
  })

  it('one: a single hero, no gallery button', () => {
    render(<PhotoMosaic photos={photos(1)} label="Sala Calma" placeholder={placeholder} />)
    expect(mosaic()).toHaveAttribute('data-layout', 'hero')
    expect(within(mosaic()).getAllByRole('img')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Mostrar todas as fotos/ })).toBeNull()
  })

  it.each([
    [2, 'halves', 2],
    [3, 'big-2', 3],
    [4, 'big-3', 4],
    [5, 'big-4', 5],
    [8, 'big-4', 5],
  ])('%i photos → the "%s" layout with %i tiles', (count, layout, tiles) => {
    render(<PhotoMosaic photos={photos(count)} label="Sala Calma" placeholder={placeholder} />)
    expect(mosaic()).toHaveAttribute('data-layout', layout)
    expect(within(mosaic()).getAllByRole('img')).toHaveLength(tiles)
    expect(screen.getByRole('button', { name: 'Mostrar todas as fotos' })).toBeInTheDocument()
  })

  it('the first photo is the big tile and every tile is a sized, cover-fitted image with its own alt', () => {
    render(<PhotoMosaic photos={photos(4)} label="Sala Calma" placeholder={placeholder} />)
    const images = within(mosaic()).getAllByRole('img')
    expect(images[0]).toHaveAttribute('src', 'http://api/media/1.webp')
    expect(images[0].closest('[data-tile]')).toHaveAttribute('data-tile', 'big')
    expect(images.map((i) => i.getAttribute('loading'))).toEqual(['eager', 'lazy', 'lazy', 'lazy'])
    images.forEach((image, i) => {
      expect(image).toHaveAttribute('width')
      expect(image).toHaveAttribute('height')
      expect(image).toHaveClass('object-cover')
      expect(image).toHaveAttribute('alt', `Sala Calma — fotografia ${i + 1} de 4`)
    })
  })

  it('is a labelled region, and below 1024px the same photos are a carousel with a counter', () => {
    render(<PhotoMosaic photos={photos(4)} label="Sala Calma" placeholder={placeholder} />)
    expect(region()).toBeInTheDocument()
    // The carousel branch: the CSS class toggles it, the DOM always has it.
    const carousel = screen.getByTestId('photo-mosaic-carousel')
    expect(carousel).toHaveClass('lg:hidden')
    expect(mosaic()).toHaveClass('lg:grid')
    expect(within(carousel).getByTestId('photo-counter')).toHaveTextContent('1 / 4')
    expect(within(carousel).queryByRole('tablist')).toBeNull()
  })
})

describe('PhotoMosaic — the gallery', () => {
  it('opens on the button, shows the full images with a counter, thumbnails and a close button, and closes on Escape', () => {
    render(<PhotoMosaic photos={photos(4)} label="Sala Calma" placeholder={placeholder} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar todas as fotos' }))
    const dialog = screen.getByRole('dialog', { name: 'Sala Calma — fotografias' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByTestId('photo-counter')).toHaveTextContent('1 / 4')
    const strip = within(dialog).getByRole('tablist', { name: 'Miniaturas' })
    expect(within(strip).getAllByRole('tab')).toHaveLength(4)
    expect(within(strip).getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens on the tapped tile, and a thumbnail moves the carousel', () => {
    render(<PhotoMosaic photos={photos(4)} label="Sala Calma" placeholder={placeholder} />)
    fireEvent.click(within(mosaic()).getAllByRole('img')[2])
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByTestId('photo-counter')).toHaveTextContent('3 / 4')
    fireEvent.click(within(dialog).getAllByRole('tab', { name: /Fotografia 1 de 4/ })[0])
    expect(within(dialog).getByTestId('photo-counter')).toHaveTextContent('1 / 4')
  })

  it('arrow keys move the gallery and the close button closes it', () => {
    render(<PhotoMosaic photos={photos(3)} label="Sala Calma" placeholder={placeholder} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar todas as fotos' }))
    const dialog = screen.getByRole('dialog')
    const carousel = within(dialog).getByRole('region', { name: 'Sala Calma — fotografias' })
    fireEvent.keyDown(carousel, { key: 'ArrowRight' })
    expect(within(dialog).getByTestId('photo-counter')).toHaveTextContent('2 / 3')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a tap on the small-screen carousel opens the gallery on that photo', () => {
    render(<PhotoMosaic photos={photos(3)} label="Sala Calma" placeholder={placeholder} />)
    const carousel = screen.getByTestId('photo-mosaic-carousel')
    fireEvent.click(within(carousel).getAllByRole('img')[1])
    expect(within(screen.getByRole('dialog')).getByTestId('photo-counter')).toHaveTextContent('2 / 3')
  })
})
