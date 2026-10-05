import type { MetadataRoute } from 'next'

// S2.1: crawling is allowed — a `Disallow: /` would also kill link previews
// and leave the `noindex` on every page unread — and nothing is indexable,
// which each page says for itself (lib/seo.ts). No sitemap: there is nothing
// to list; flowspace.pt has the one that matters.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/' }] }
}
