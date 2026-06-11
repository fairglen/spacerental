import { useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { createAuthenticatedApi } from '@/lib/api'

/**
 * Bare authenticated axios instance — no org_id default.
 * Use this for endpoints that must not be scoped to an org (e.g. /auth/memberships),
 * or from inside OrgContext itself to avoid a circular dependency with useApi.
 */
export function useAuthInstance() {
  const { data: session } = useSession()
  return useMemo(
    () => createAuthenticatedApi(session?.accessToken),
    [session?.accessToken]
  )
}
