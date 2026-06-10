import { useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { createAuthenticatedApi } from '@/lib/api'
import { useOrg } from '@/contexts/OrgContext'

export function useApi() {
  const { data: session } = useSession()
  const { currentOrgId } = useOrg()
  return useMemo(() => {
    const instance = createAuthenticatedApi(session?.accessToken)
    if (currentOrgId) {
      // Default query params for every request; per-call params merge on top of these.
      instance.defaults.params = { ...(instance.defaults.params || {}), org_id: currentOrgId }
    }
    return instance
  }, [session?.accessToken, currentOrgId])
}
