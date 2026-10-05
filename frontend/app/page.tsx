import { HydrationBoundary, type DehydratedState } from '@tanstack/react-query'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Hero } from '@/components/landing/Hero'
import { SpaceCards } from '@/components/landing/SpaceCards'
import { ValueProps } from '@/components/landing/ValueProps'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { Pricing } from '@/components/landing/Pricing'
import { loadLandingData } from '@/lib/landing'
import { dehydratedLandingState } from '@/lib/landingState'
import type { Metadata } from 'next'
import { SITE_CANONICAL } from '@/lib/seo'

// P1.2: rendered per request with the data already in the HTML. Dynamic
// rather than static + ISR because the image is built where no API exists;
// the data itself is cached for a minute (lib/landing.ts).
export const dynamic = 'force-dynamic'

// S2.1: the landing and flowspace.pt say the same thing; the site is the one
// that ranks.
export const metadata: Metadata = { alternates: { canonical: SITE_CANONICAL } }

async function landingState(): Promise<DehydratedState | null> {
  try {
    return dehydratedLandingState(await loadLandingData())
  } catch (error) {
    // Loud, not silent: the page still renders, and the browser fetches as it
    // did before — nothing the customer sees depends on this succeeding.
    console.error('[landing] server-side data unavailable, rendering without it:', error instanceof Error ? error.message : error)
    return null
  }
}

export default async function Home() {
  const state = await landingState()
  const page = (
    <>
      <Navbar />
      <main>
        <Hero />
        <ValueProps />
        <SpaceCards />
        <HowItWorks />
        <Pricing />
      </main>
      <Footer />
    </>
  )
  return state ? <HydrationBoundary state={state}>{page}</HydrationBoundary> : page
}
