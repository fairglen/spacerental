import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Footer } from '@/components/layout/Footer'
import { useSingleSpace, type SingleSpaceState } from '@/lib/hooks/useSingleSpace'
import type { Space } from '@/types'

vi.mock('@/lib/hooks/useSingleSpace', () => ({ useSingleSpace: vi.fn() }))

const space = (city: string | null): Space => ({
  id: 's-1', org_id: 'o', name: 'Espaço', description: '', address: 'Rua', city: city as string,
  images: [], amenities: [], is_active: true, created_at: '',
})
const state = (partial: Partial<SingleSpaceState>): SingleSpaceState =>
  ({ mode: 'multi', space: null, spaces: [], retry: vi.fn(), ...partial })

const footerLocation = () => screen.getByTestId('footer-location').textContent ?? ''

// C10: the footer used to hard-code "Lisboa, Portugal".
describe('Footer location', () => {
  it('names the city of the one space there is', () => {
    vi.mocked(useSingleSpace).mockReturnValue(state({ mode: 'single', space: space('Queluz') }))
    render(<Footer />)
    expect(footerLocation()).toContain('Queluz')
  })

  it.each<[string, Partial<SingleSpaceState>]>([
    ['several spaces', { mode: 'multi', spaces: [space('Queluz'), space('Porto')] }],
    ['no spaces', { mode: 'empty' }],
    ['a failed lookup', { mode: 'error' }],
    ['one space without a city', { mode: 'single', space: space(null) }],
  ])('falls back to a generic line with %s', (_label, partial) => {
    vi.mocked(useSingleSpace).mockReturnValue(state(partial))
    render(<Footer />)
    expect(footerLocation()).not.toMatch(/Queluz|Porto|Lisboa|Lisbon|null/)
    expect(footerLocation().trim()).not.toBe('')
  })

  it('shows no place at all while the answer is unknown', () => {
    vi.mocked(useSingleSpace).mockReturnValue(state({ mode: 'loading' }))
    render(<Footer />)
    expect(footerLocation().trim()).toBe('')
  })
})
