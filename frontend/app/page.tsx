import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Hero } from '@/components/landing/Hero'
import { SpaceCards } from '@/components/landing/SpaceCards'
import { TheSpace } from '@/components/landing/TheSpace'
import { ValueProps } from '@/components/landing/ValueProps'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { Pricing } from '@/components/landing/Pricing'

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <ValueProps />
        <SpaceCards />
        <TheSpace />
        <HowItWorks />
        <Pricing />
      </main>
      <Footer />
    </>
  )
}
