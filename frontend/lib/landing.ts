// Server side only — imported by app/page.tsx, a server component (P1.2).
// The landing's reads go through the Docker-internal API URL at render time,
// so the first HTML already carries the space, its rooms, the contact and the
// packs, and the browser has nothing to fetch before it can paint them. The
// result is cached for a minute in Next's Data Cache; a failure is not cached
// and the page then renders without it, with the browser fetching as before.
import axios from 'axios'
import { unstable_cache } from 'next/cache'
import { spacesApi } from '@/lib/api'
import type { Package, PublicContact, Room, Space } from '@/types'

export type SpaceDetail = { space: Space; rooms: Room[]; contact?: PublicContact }
export type LandingData = {
  spaces: Space[]
  /** The one public space with its packs — null unless exactly one space is visible. */
  detail: (SpaceDetail & { packages: Package[] }) | null
}

// Same resolution as lib/auth.ts: the service name inside Docker, the public
// URL when the frontend runs outside it.
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

/** What the landing renders from, through the same wrappers the browser uses; `api` is injectable for tests. */
export async function fetchLandingData(api = axios.create({ baseURL: INTERNAL_API_URL, timeout: 5_000 })): Promise<LandingData> {
  const spaces = await spacesApi.list(api)
  const detail = spaces.length === 1 ? await spacesApi.getWithPackages(spaces[0].id, api) : null
  return { spaces, detail }
}

/**
 * How long the data is kept across requests, in seconds. DECISION: 0 by
 * default — every landing render reads the API (two calls on the Docker
 * network, against the four the browser used to make), so an operator's
 * price change is on the page at once; `admin.spec.ts` (C06) pins that, and
 * the API has no way to invalidate a cache here yet (TODO.md P1.6). Set it
 * for real traffic once it has: the server's own reads count against the
 * public rate limit of the frontend's address, and past that limit the page
 * logs and renders without data (the browser then fetches, as before).
 */
export function landingCacheSeconds(env: Record<string, string | undefined> = process.env): number {
  const raw = env.LANDING_CACHE_SECONDS?.trim()
  if (!raw) return 0
  if (!/^\d+$/.test(raw)) throw new Error(`LANDING_CACHE_SECONDS must be a whole number of seconds, got ${JSON.stringify(raw)}`)
  return Number(raw)
}

export async function loadLandingData(): Promise<LandingData> {
  const seconds = landingCacheSeconds()
  if (seconds === 0) return fetchLandingData()
  // A failure is not cached: the page decides, and the next request retries.
  return unstable_cache(() => fetchLandingData(), ['landing-data'], { revalidate: seconds })()
}
