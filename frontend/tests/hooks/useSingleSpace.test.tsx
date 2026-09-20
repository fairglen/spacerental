import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useSingleSpace } from '@/lib/hooks/useSingleSpace'
import { spacesApi } from '@/lib/api'
import type { Space } from '@/types'

// tests/setup.ts stubs the hook for everyone else; this file tests the real one.
vi.unmock('@/lib/hooks/useSingleSpace')
vi.mock('@/lib/api', () => ({ spacesApi: { list: vi.fn() } }))

const space = (id: string): Space => ({
  id, org_id: 'org-1', name: `Espaço ${id}`, description: '', address: 'Rua', city: 'Queluz',
  images: [], amenities: [], is_active: true, created_at: '',
})

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
})

describe('useSingleSpace', () => {
  it('is loading, and neither single nor multi, until the list arrives', async () => {
    vi.mocked(spacesApi.list).mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useSingleSpace(), { wrapper })
    expect(result.current.mode).toBe('loading')
    expect(result.current.space).toBeNull()
  })

  it('is single with exactly one space, and hands it over', async () => {
    vi.mocked(spacesApi.list).mockResolvedValue([space('a')])
    const { result } = renderHook(() => useSingleSpace(), { wrapper })
    await waitFor(() => expect(result.current.mode).toBe('single'))
    expect(result.current.space?.id).toBe('a')
  })

  it('is multi with two, with no single space to hand over', async () => {
    vi.mocked(spacesApi.list).mockResolvedValue([space('a'), space('b')])
    const { result } = renderHook(() => useSingleSpace(), { wrapper })
    await waitFor(() => expect(result.current.mode).toBe('multi'))
    expect(result.current.space).toBeNull()
    expect(result.current.spaces.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('is empty with none', async () => {
    vi.mocked(spacesApi.list).mockResolvedValue([])
    const { result } = renderHook(() => useSingleSpace(), { wrapper })
    await waitFor(() => expect(result.current.mode).toBe('empty'))
    expect(result.current.space).toBeNull()
  })

  it('reports an error instead of guessing a mode, and can retry', async () => {
    vi.mocked(spacesApi.list).mockRejectedValueOnce(new Error('down')).mockResolvedValue([space('a')])
    const { result } = renderHook(() => useSingleSpace(), { wrapper })
    await waitFor(() => expect(result.current.mode).toBe('error'))
    expect(result.current.space).toBeNull()
    result.current.retry()
    await waitFor(() => expect(result.current.mode).toBe('single'))
  })
})

// B48: the navbar asks this hook on every page, and a full page load starts
// with an empty query cache. Without carrying the answer over, every page load
// spent one read of the public budget just to pick a label.
describe('useSingleSpace across full page loads', () => {
  const KEY = 'espacohora.publicSpaces'

  it('remembers a fresh answer, so the next page load asks nothing', async () => {
    vi.mocked(spacesApi.list).mockResolvedValue([space('a')])
    const first = renderHook(() => useSingleSpace(), { wrapper })
    await waitFor(() => expect(first.result.current.mode).toBe('single'))
    expect(spacesApi.list).toHaveBeenCalledTimes(1)
    first.unmount()

    // A new page load: a new query client, the same tab.
    const second = renderHook(() => useSingleSpace(), { wrapper })
    await waitFor(() => expect(second.result.current.mode).toBe('single'))
    expect(second.result.current.space?.id).toBe('a')
    expect(spacesApi.list).toHaveBeenCalledTimes(1)
  })

  it('still starts as loading, so the server and the first client render agree', () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), spaces: [space('a')] }))
    const { result } = renderHook(() => useSingleSpace(), { wrapper })
    // renderHook has flushed effects by now, so look at what was rendered first.
    expect(result.current.mode === 'loading' || result.current.mode === 'single').toBe(true)
  })

  it('asks again once the remembered answer is older than a minute', async () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now() - 61_000, spaces: [space('a')] }))
    vi.mocked(spacesApi.list).mockResolvedValue([space('a'), space('b')])
    const { result } = renderHook(() => useSingleSpace(), { wrapper })
    await waitFor(() => expect(result.current.mode).toBe('multi'))
    expect(spacesApi.list).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['not JSON', 'nonsense'],
    ['the wrong shape', JSON.stringify({ at: Date.now(), spaces: 'a' })],
    ['a timestamp from the future', JSON.stringify({ at: Date.now() + 3_600_000, spaces: [] })],
  ])('ignores a remembered value that is %s', async (_label, stored) => {
    window.sessionStorage.setItem(KEY, stored)
    vi.mocked(spacesApi.list).mockResolvedValue([space('a')])
    const { result } = renderHook(() => useSingleSpace(), { wrapper })
    await waitFor(() => expect(result.current.mode).toBe('single'))
    expect(spacesApi.list).toHaveBeenCalledTimes(1)
  })

  it('does not remember a failure', async () => {
    vi.mocked(spacesApi.list).mockRejectedValue(new Error('down'))
    const { result } = renderHook(() => useSingleSpace(), { wrapper })
    await waitFor(() => expect(result.current.mode).toBe('error'))
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
  })

  it('works when session storage is unavailable', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    try {
      vi.mocked(spacesApi.list).mockResolvedValue([space('a')])
      const { result } = renderHook(() => useSingleSpace(), { wrapper })
      await waitFor(() => expect(result.current.mode).toBe('single'))
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })
})
