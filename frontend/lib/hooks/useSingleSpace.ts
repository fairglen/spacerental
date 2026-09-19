import { useQuery } from '@tanstack/react-query'
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
export function useSingleSpace(): SingleSpaceState {
  // Same key as every other public spaces list, so the answer is fetched once.
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['spaces'],
    queryFn: () => spacesApi.list(),
  })
  const retry = () => { void refetch() }

  if (isPending) return { mode: 'loading', space: null, spaces: [], retry }
  if (isError) return { mode: 'error', space: null, spaces: [], retry }
  if (data.length === 0) return { mode: 'empty', space: null, spaces: [], retry }
  if (data.length === 1) return { mode: 'single', space: data[0], spaces: data, retry }
  return { mode: 'multi', space: null, spaces: data, retry }
}
