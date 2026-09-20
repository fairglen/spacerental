import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { spacesApi } from '@/lib/api'
import type { Space } from '@/types'

export type SpaceMode = 'loading' | 'error' | 'empty' | 'single' | 'multi'

export type SingleSpaceState = {
  mode: SpaceMode
  /** The one publicly visible space; null in every mode but 'single'. */
  space: Space | null
  spaces: Space[]
  retry: () => void
}

/**
 * The ONE place that decides whether customers see a "choose a space" layer.
 *
 * While exactly one active space is publicly visible they go straight to its
 * rooms; a second space brings the spaces UI back with no code change. Ask
 * this hook — do not count spaces anywhere else.
 *
 * 'loading' and 'error' are modes of their own so a caller cannot render the
 * multi-space UI and then swap it: nothing mode-specific should be drawn until
 * the mode is 'single', 'multi' or 'empty'.
 */
// How long an answer counts as fresh — the same minute the app-wide query
// cache already trusts it for during in-app navigation.
const FRESH_MS = 60_000
const STORAGE_KEY = 'espacohora.publicSpaces'
const QUERY_KEY = ['spaces']

/**
 * The last answer, if this tab got one less than a minute ago.
 *
 * The navbar asks this hook on every page, and a FULL page load (a reload, the
 * return from checkout, a typed URL) starts with an empty query cache, so each
 * one spent a read of the shared public rate budget just to choose between
 * "Salas" and "Espaços" (TODO.md B48). Carrying the answer across page loads
 * for the minute it is fresh anyway removes that. Storage can be unavailable
 * or hold anything; every failure just means asking the API, as before.
 */
function rememberedSpaces(): { spaces: Space[]; at: number } | null {
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null')
    if (typeof stored !== 'object' || stored === null) return null
    const { at, spaces } = stored as { at?: unknown; spaces?: unknown }
    if (typeof at !== 'number' || !Array.isArray(spaces)) return null
    const age = Date.now() - at
    return age >= 0 && age < FRESH_MS ? { spaces: spaces as Space[], at } : null
  } catch {
    return null
  }
}

function rememberSpaces(spaces: Space[], at: number) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ at, spaces }))
  } catch {
    // Nothing to do: the next page load asks the API.
  }
}

export function useSingleSpace(): SingleSpaceState {
  const queryClient = useQueryClient()
  // Storage is read after mount, never during render: the server has none, and
  // the first client render must match its HTML (both draw the loading state).
  const [checkedStorage, setCheckedStorage] = useState(false)
  useEffect(() => {
    const remembered = rememberedSpaces()
    if (remembered && queryClient.getQueryData(QUERY_KEY) === undefined) {
      queryClient.setQueryData(QUERY_KEY, remembered.spaces, { updatedAt: remembered.at })
    }
    setCheckedStorage(true)
  }, [queryClient])

  // Same key as every other public spaces list, so the answer is fetched once.
  const { data, isPending, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => spacesApi.list(),
    staleTime: FRESH_MS,
    enabled: checkedStorage,
  })
  useEffect(() => {
    if (data) rememberSpaces(data, dataUpdatedAt)
  }, [data, dataUpdatedAt])
  const retry = () => { void refetch() }

  if (isPending) return { mode: 'loading', space: null, spaces: [], retry }
  if (isError) return { mode: 'error', space: null, spaces: [], retry }
  if (data.length === 0) return { mode: 'empty', space: null, spaces: [], retry }
  if (data.length === 1) return { mode: 'single', space: data[0], spaces: data, retry }
  return { mode: 'multi', space: null, spaces: data, retry }
}
