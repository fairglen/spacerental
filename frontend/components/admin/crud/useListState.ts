'use client'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useOrg } from '@/contexts/OrgContext'

/**
 * List state that lives in the URL (G05): `?q=&page=&sort=&<filter>=`, so a
 * reload, the back button and a shared link all land on the same view.
 * Setting a value other than `page` resets the page to 1.
 */
export type ListState = { q: string; page: number; sort: string; filters: Record<string, string> }

export function useListState(filterKeys: readonly string[], defaults: { sort?: string } = {}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const state = useMemo<ListState>(() => {
    const filters: Record<string, string> = {}
    for (const key of filterKeys) {
      const value = params.get(key)
      if (value) filters[key] = value
    }
    const page = Number(params.get('page') ?? '1')
    return {
      q: params.get('q') ?? '',
      page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
      sort: params.get('sort') ?? defaults.sort ?? '',
      filters,
    }
  }, [params, filterKeys, defaults.sort])

  const set = useCallback(
    (patch: Partial<{ q: string; page: number; sort: string }> & { filters?: Record<string, string | undefined> }) => {
      const next = new URLSearchParams(params.toString())
      const put = (key: string, value: string | number | undefined) => {
        if (value === undefined || value === '' || value === null) next.delete(key)
        else next.set(key, String(value))
      }
      if ('q' in patch) put('q', patch.q)
      if ('sort' in patch) put('sort', patch.sort === defaults.sort ? undefined : patch.sort)
      if (patch.filters) for (const [key, value] of Object.entries(patch.filters)) put(key, value)
      if ('page' in patch) put('page', patch.page && patch.page > 1 ? patch.page : undefined)
      else next.delete('page')
      const query = next.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [params, pathname, router, defaults.sort],
  )
  // Switching organisation (B22-style deep links aside): a later page may not
  // exist in the smaller one, and a filter's room/user/package id belongs to
  // the old tenant, so the list goes back to page one with no filters.
  const { currentOrgId } = useOrg()
  const seenOrg = useRef(currentOrgId)
  useEffect(() => {
    if (seenOrg.current === currentOrgId) return
    seenOrg.current = currentOrgId
    if (state.page > 1 || Object.keys(state.filters).length > 0) {
      set({ page: 1, filters: Object.fromEntries(filterKeys.map((key) => [key, undefined])) })
    }
  }, [currentOrgId, state.page, state.filters, filterKeys, set])
  return { state, set }
}
