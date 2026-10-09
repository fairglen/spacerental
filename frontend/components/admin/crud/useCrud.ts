'use client'
import { useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { useOrg } from '@/contexts/OrgContext'

/**
 * `useCrud(entity)` (G05): the query keys and the invalidation every entity
 * page shares, over `lib/api.ts`. Keys are `['admin', <entity>, org, ...]`
 * so switching organisation never shows another tenant's cache.
 */
export type CrudEntity = 'spaces' | 'rooms' | 'bookings' | 'users' | 'packages' | 'purchases' | 'support' | 'organization' | 'audit' | 'billing'

export function useCrud(entity: CrudEntity) {
  const api = useApi()
  const qc = useQueryClient()
  const { currentOrgId } = useOrg()
  const listKey = (params?: unknown) => ['admin', entity, currentOrgId, 'list', params ?? {}] as const
  const detailKey = (id: string) => ['admin', entity, currentOrgId, id] as const
  // Everything under the entity (lists, details, histories) and the public
  // caches the customer pages read, since an operator's edit shows there too.
  const invalidate = async (id?: string) => {
    await qc.invalidateQueries({ queryKey: ['admin', entity] })
    await qc.invalidateQueries({ queryKey: ['admin', 'history'] })
    await qc.invalidateQueries({ queryKey: ['admin', 'spaces'] })
    if (id) await qc.invalidateQueries({ queryKey: detailKey(id) })
    await qc.invalidateQueries({ queryKey: ['spaces'] })
    await qc.invalidateQueries({ queryKey: ['space'] })
  }
  return { api, adminApi, currentOrgId, enabled: !!currentOrgId, listKey, detailKey, invalidate }
}
