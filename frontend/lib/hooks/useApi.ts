import { useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { createAuthenticatedApi } from '@/lib/api'

export function useApi() {
  const { data: session } = useSession()
  return useMemo(
    () => createAuthenticatedApi(session?.accessToken),
    [session?.accessToken]
  )
}
