'use client'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
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

  // The user's explicit choice. Read synchronously so the very first render
  // that knows the memberships also knows the current org: the admin layout
  // redirects on any render where memberships are loaded but no current
  // membership resolves, and a `useEffect` that set this one render later was
  // exactly that render (B22).
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(() =>
    typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null,
  )

  const currentOrgId = useMemo(() => {
    if (!isAuthed || memberships.length === 0) return null
    if (selectedOrgId && memberships.some((m) => m.org_id === selectedOrgId)) return selectedOrgId
    return pickDefaultOrg(memberships)
  }, [isAuthed, memberships, selectedOrgId])

  const setCurrentOrgId = useCallback((orgId: string) => {
    setSelectedOrgId(orgId)
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
