import '@testing-library/jest-dom'
import { vi } from 'vitest'
import React from 'react'

// jsdom doesn't implement scrollIntoView; components that scroll a
// highlighted element into view (e.g. MyPackagesPage, B12) would otherwise
// throw in every test that mounts them, package-highlighting or not.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn()
}

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}))

// Mock next/link. The real component reads its router from React context
// (AppRouterContext/RouterContext), which no provider in the render tree
// supplies here. Its own click handler then bails out before calling
// preventDefault (`if (!router) return`), so a real <a href> click reaches
// jsdom, which doesn't implement navigation and throws "Not implemented:
// navigation (except hash changes)". Render a plain anchor instead and
// prevent the default browser navigation ourselves, the same way the real
// component would once client-side routing takes over.
type MockLinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string | { pathname?: string }
}

vi.mock('next/link', () => ({
  default: React.forwardRef<HTMLAnchorElement, MockLinkProps>(function MockLink(
    { href, children, onClick, ...props },
    ref,
  ) {
    return React.createElement(
      'a',
      {
        ref,
        href: typeof href === 'string' ? href : href?.pathname ?? '',
        onClick: (e: React.MouseEvent<HTMLAnchorElement>) => {
          onClick?.(e)
          if (!e.defaultPrevented) e.preventDefault()
        },
        ...props,
      },
      children,
    )
  }),
}))

// Mock next-auth/react
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
  signIn: vi.fn(),
  signOut: vi.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}))
