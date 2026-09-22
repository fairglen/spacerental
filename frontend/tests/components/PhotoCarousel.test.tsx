import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { PhotoCarousel } from '@/components/spaces/PhotoCarousel'
import type { Photo } from '@/types'

const photos = (n: number): Photo[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`, url: `http://api/media/${i + 1}.webp`, thumb_url: `http://api/media/${i + 1}_thumb.webp`,
    width: 1600, height: 1200,
  }))

const placeholder = <div data-testid="placeholder">🛋️</div>

// jsdom implements no PointerEvent, so fireEvent.pointer* would arrive without
// coordinates. Every browser we support has it; give the test environment one.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventShim extends MouseEvent {}
  Object.defineProperty(window, 'PointerEvent', { value: PointerEventShim, configurable: true })
}
const region = () => screen.getByRole('region', { name: 'Sala Calma — fotografias' })
const selectedDot = () => screen.getAllByRole('tab').findIndex((t) => t.getAttribute('aria-selected') === 'true')

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})

describe('PhotoCarousel — how many photos', () => {
  it('zero: the placeholder it was given, and no carousel at all', () => {
    render(<PhotoCarousel photos={[]} label="Sala Calma" placeholder={placeholder} />)
    expect(screen.getByTestId('placeholder')).toBeVisible()
    expect(screen.queryByRole('region')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('one: the photo, with no controls and no indicators', () => {
    render(<PhotoCarousel photos={photos(1)} label="Sala Calma" placeholder={placeholder} />)
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByTestId('photo-counter')).toBeNull()
  })

  it('three: previous/next and a dot per photo', () => {
    render(<PhotoCarousel photos={photos(3)} label="Sala Calma" placeholder={placeholder} />)
    expect(screen.getByRole('button', { name: 'Fotografia anterior' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fotografia seguinte' })).toBeInTheDocument()
    const dots = within(screen.getByRole('tablist')).getAllByRole('tab')
    expect(dots.map((d) => d.getAttribute('aria-label'))).toEqual(['Fotografia 1 de 3', 'Fotografia 2 de 3', 'Fotografia 3 de 3'])
    expect(selectedDot()).toBe(0)
    expect(screen.queryByTestId('photo-counter')).toBeNull()
  })

  it('five still gets dots; six or more gets a counter instead', () => {
    const { unmount } = render(<PhotoCarousel photos={photos(5)} label="Sala Calma" placeholder={placeholder} />)
    expect(screen.getAllByRole('tab')).toHaveLength(5)
    unmount()
    render(<PhotoCarousel photos={photos(8)} label="Sala Calma" placeholder={placeholder} />)
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByTestId('photo-counter')).toHaveTextContent('1 / 8')
  })
})

describe('PhotoCarousel — moving through the photos', () => {
  it('next and previous move one at a time and stop at the ends', () => {
    render(<PhotoCarousel photos={photos(3)} label="Sala Calma" placeholder={placeholder} />)
    const prev = screen.getByRole('button', { name: 'Fotografia anterior' })
    const next = screen.getByRole('button', { name: 'Fotografia seguinte' })
    expect(prev).toBeDisabled()
    fireEvent.click(next)
    expect(selectedDot()).toBe(1)
    fireEvent.click(next)
    expect(selectedDot()).toBe(2)
    expect(next).toBeDisabled()
    fireEvent.click(prev)
    expect(selectedDot()).toBe(1)
  })

  it('arrow keys on the frame do the same', () => {
    render(<PhotoCarousel photos={photos(8)} label="Sala Calma" placeholder={placeholder} />)
    region().focus()
    fireEvent.keyDown(region(), { key: 'ArrowRight' })
    fireEvent.keyDown(region(), { key: 'ArrowRight' })
    expect(screen.getByTestId('photo-counter')).toHaveTextContent('3 / 8')
    fireEvent.keyDown(region(), { key: 'ArrowLeft' })
    expect(screen.getByTestId('photo-counter')).toHaveTextContent('2 / 8')
  })

  it('a dot jumps straight to its photo', () => {
    render(<PhotoCarousel photos={photos(4)} label="Sala Calma" placeholder={placeholder} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Fotografia 4 de 4' }))
    expect(selectedDot()).toBe(3)
  })

  it('announces the position only when the visitor moved it', () => {
    render(<PhotoCarousel photos={photos(3)} label="Sala Calma" placeholder={placeholder} />)
    const live = screen.getByTestId('photo-announcer')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live).toBeEmptyDOMElement()
    fireEvent.click(screen.getByRole('button', { name: 'Fotografia seguinte' }))
    expect(live).toHaveTextContent('Fotografia 2 de 3')
  })

  it('never moves by itself', () => {
    vi.useFakeTimers()
    try {
      render(<PhotoCarousel photos={photos(3)} label="Sala Calma" placeholder={placeholder} />)
      vi.advanceTimersByTime(60_000)
      expect(selectedDot()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('scrolls without animation when the visitor prefers reduced motion', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'), media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }))
    const scrollTo = vi.fn()
    render(<PhotoCarousel photos={photos(3)} label="Sala Calma" placeholder={placeholder} />)
    screen.getByTestId('photo-track').scrollTo = scrollTo
    fireEvent.click(screen.getByRole('button', { name: 'Fotografia seguinte' }))
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }))
  })
})

describe('PhotoCarousel — semantics and loading', () => {
  it('is a labelled carousel region, focusable, with decorative icons hidden', () => {
    render(<PhotoCarousel photos={photos(3)} label="Sala Calma" placeholder={placeholder} />)
    expect(region()).toHaveAttribute('aria-roledescription', 'carrossel')
    expect(region()).toHaveAttribute('tabindex', '0')
    for (const button of screen.getAllByRole('button')) {
      expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('loads the first image eagerly and the rest lazily, with sizes so nothing shifts', () => {
    render(<PhotoCarousel photos={photos(3)} label="Sala Calma" placeholder={placeholder} />)
    const images = screen.getAllByRole('img')
    expect(images.map((i) => i.getAttribute('loading'))).toEqual(['eager', 'lazy', 'lazy'])
    for (const image of images) {
      expect(image).toHaveAttribute('width')
      expect(image).toHaveAttribute('height')
      expect(image.getAttribute('alt')).toMatch(/Sala Calma/)
    }
  })

  it('uses thumbnails on a card and full images on the room page', () => {
    const { unmount } = render(<PhotoCarousel photos={photos(2)} label="Sala Calma" placeholder={placeholder} size="card" />)
    expect(screen.getAllByRole('img')[0]).toHaveAttribute('src', 'http://api/media/1_thumb.webp')
    unmount()
    render(<PhotoCarousel photos={photos(2)} label="Sala Calma" placeholder={placeholder} size="page" />)
    expect(screen.getAllByRole('img')[0]).toHaveAttribute('src', 'http://api/media/1.webp')
  })

  it('gives its buttons a hit area of at least 44px', () => {
    render(<PhotoCarousel photos={photos(3)} label="Sala Calma" placeholder={placeholder} />)
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toMatch(/\bh-11\b/)
      expect(button.className).toMatch(/\bw-11\b/)
    }
  })
})

describe('PhotoCarousel — inside something clickable', () => {
  it('its controls never trigger the surrounding click', () => {
    const onCardClick = vi.fn()
    render(
      <div onClick={onCardClick}>
        <PhotoCarousel photos={photos(3)} label="Sala Calma" placeholder={placeholder} />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Fotografia seguinte' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Fotografia 3 de 3' }))
    fireEvent.keyDown(region(), { key: 'ArrowLeft' })
    expect(onCardClick).not.toHaveBeenCalled()
  })

  it('a swipe across the photos is not a click; a tap still is', () => {
    const onCardClick = vi.fn()
    render(
      <div onClick={onCardClick}>
        <PhotoCarousel photos={photos(3)} label="Sala Calma" placeholder={placeholder} />
      </div>,
    )
    const track = screen.getByTestId('photo-track')
    fireEvent.pointerDown(track, { clientX: 200, clientY: 50 })
    fireEvent.pointerMove(track, { clientX: 80, clientY: 52 })
    fireEvent.pointerUp(track, { clientX: 80, clientY: 52 })
    fireEvent.click(track)
    expect(onCardClick).not.toHaveBeenCalled()

    fireEvent.pointerDown(track, { clientX: 200, clientY: 50 })
    fireEvent.pointerUp(track, { clientX: 201, clientY: 50 })
    fireEvent.click(track)
    expect(onCardClick).toHaveBeenCalledTimes(1)
  })
})
