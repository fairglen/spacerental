// The landing's server-side data as a React Query hydration state (P1.2):
// pure, so a unit test can pin that every key matches what the components ask
// for — a key that drifts would silently bring the client fetches back.
import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query'
import type { LandingData } from '@/lib/landing'
import { queryKeys } from '@/lib/queryKeys'

export function dehydratedLandingState({ spaces, detail }: LandingData): DehydratedState {
  const client = new QueryClient()
  client.setQueryData(queryKeys.spaces, spaces)
  if (detail) {
    const { packages, ...spaceDetail } = detail
    client.setQueryData(queryKeys.space(detail.space.id), spaceDetail)
    client.setQueryData(queryKeys.pricingPackages(detail.space.org_id), packages)
  }
  return dehydrate(client)
}
