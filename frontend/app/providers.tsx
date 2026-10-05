'use client'
import { useState } from 'react'
import { SessionProvider } from 'next-auth/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrgProvider } from '@/contexts/OrgContext'
import { HelpProvider } from '@/components/help/HelpProvider'

// P1.4: no refetch on window focus by default — for the catalog, the
// availability and the dashboard a tab switch is pure cost; the queries that
// want it (the operator calendar) say so themselves.
const QUERY_DEFAULTS = { queries: { staleTime: 60 * 1000, retry: 1, refetchOnWindowFocus: false } }

export function ReactQueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: QUERY_DEFAULTS }))
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: QUERY_DEFAULTS }))
  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <OrgProvider>
          <HelpProvider>{children}</HelpProvider>
        </OrgProvider>
      </QueryClientProvider>
    </SessionProvider>
  )
}
