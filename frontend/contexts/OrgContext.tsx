'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { authApi } from '@/lib/api'
import { useAuthInstance } from '@/lib/hooks/useAuthInstance'
import type { Membership } from '@/types'

const STORAGE_KEY = 'spacerental:selected_org_id'

type Role = 'owner' | 'admin' | 'member'

const roleRank: Record<Role, number> = { owner: 0, admin: 1, member: 2 }

function pickDefaultOrg(memberships: Membership[]): string | null {
  if (memberships.length === 0) return null
  const sorted = [...memberships].sort((a, b) => roleRank[a.role] - roleRank[b.role])
  return sorted[0].org_id
}

type OrgContextValue = {
  memberships: Membership[]
  currentOrgId: string | null
  currentMembership: Membership | null
  setCurrentOrgId: (orgId: string) => void
  isLoading: boolean
}

const OrgContext = createContext<OrgContextValue | undefined>(undefined)

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const { status, data: session } = useSession()
  const api = useAuthInstance()
  const isAuthed = status === 'authenticated'

  // Hydrate from session JWT first (cheap), then refresh from the API for up-to-date org names.
  const sessionMemberships = useMemo<Membership[]>(() => {
    if (!session?.memberships) return []
    // Session has {org_id, role}; org_name/slug get filled in by the API fetch below.
    return session.memberships.map((m) => ({
      org_id: m.org_id,
      org_name: '',
      org_slug: '',
      role: m.role,
    }))
  }, [session?.memberships])

  const { data: fetched, isLoading } = useQuery({
    queryKey: ['auth', 'memberships', session?.user?.id],
    queryFn: () => authApi.getMemberships(api),
    enabled: isAuthed,
    staleTime: 5 * 60 * 1000,
  })

  const memberships: Membership[] = fetched ?? sessionMemberships

  const [currentOrgId, setOrgIdState] = useState<string | null>(null)

  // Initialize from localStorage when memberships become known.
  useEffect(() => {
    if (!isAuthed || memberships.length === 0) {
      setOrgIdState(null)
      return
    }
    const stored =
      typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null
    const validStored = stored && memberships.some((m) => m.org_id === stored) ? stored : null
    setOrgIdState(validStored ?? pickDefaultOrg(memberships))
  }, [isAuthed, memberships])

  const setCurrentOrgId = useCallback((orgId: string) => {
    setOrgIdState(orgId)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, orgId)
    }
  }, [])

  const currentMembership = useMemo(
    () => memberships.find((m) => m.org_id === currentOrgId) ?? null,
    [memberships, currentOrgId]
  )

  const value: OrgContextValue = {
    memberships,
    currentOrgId,
    currentMembership,
    setCurrentOrgId,
    isLoading: isAuthed && isLoading && memberships.length === 0,
  }

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext)
  if (!ctx) {
    // Public pages (no <OrgProvider>) get an inert default; calls don't crash.
    return {
      memberships: [],
      currentOrgId: null,
      currentMembership: null,
      setCurrentOrgId: () => {},
      isLoading: false,
    }
  }
  return ctx
}
