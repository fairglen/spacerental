import { describe, it, expect, vi } from 'vitest'

// The root layout loads Inter through next/font/google, which only the Next
// compiler can resolve; the metadata is what this test is about.
vi.mock('next/font/google', () => ({ Inter: () => ({ className: 'inter' }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {}, backendAcceptsToken: vi.fn() }))
// B65: the auth layouts' titles follow the locale cookie, so their metadata
// is a function over `next/headers`; `cookies()` throws outside a request.
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }) }))

import { metadata as root } from '@/app/layout'
import { metadata as landing } from '@/app/page'
import { metadata as spaces } from '@/app/spaces/layout'
import { metadata as dashboard } from '@/app/dashboard/layout'
import { metadata as admin } from '@/app/admin/layout'
import { generateMetadata as signInMetadata } from '@/app/(auth)/sign-in/layout'
import { generateMetadata as resetPasswordMetadata } from '@/app/(auth)/reset-password/[token]/layout'
import robots from '@/app/robots'

const signIn = signInMetadata()
const resetPassword = resetPasswordMetadata()

// S2.1: route metadata — what each page's <meta name="robots"> and the
// landing's <link rel="canonical"> are rendered from.
describe('robots metadata per route', () => {
  it('the root says noindex, follow and the landing canonicalises to flowspace.pt', () => {
    expect(root.robots).toEqual({ index: false, follow: true })
    expect(landing.alternates).toEqual({ canonical: 'https://flowspace.pt/' })
    // Only the landing: no other route claims the site as its canonical.
    for (const m of [spaces, dashboard, admin, signIn, resetPassword]) expect(m.alternates).toBeUndefined()
  })

  it('the private surface adds nofollow; the public rooms inherit noindex, follow', () => {
    for (const m of [dashboard, admin, signIn, resetPassword]) expect(m.robots).toEqual({ index: false, follow: false })
    expect(spaces.robots).toBeUndefined()
    expect(landing.robots).toBeUndefined()
  })

  it('the Open Graph card stays, so shared app links still preview', () => {
    expect(root.openGraph?.images).toEqual([{ url: '/brand/og-image.png', width: 1200, height: 630, alt: 'FlowSpace' }])
    expect(root.openGraph?.locale).toBe('pt_PT')
  })

  it('robots.txt allows crawling and lists no sitemap', () => {
    expect(robots()).toEqual({ rules: [{ userAgent: '*', allow: '/' }] })
  })
})
