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

beforeEach(() => vi.clearAllMocks())

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
