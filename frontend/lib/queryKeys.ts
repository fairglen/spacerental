// The React Query keys the public pages share. One place, so the server can
// hydrate exactly where the hooks look (lib/landingState.ts, P1.2) and two
// components asking for the same thing get one request.
export const queryKeys = {
  /** The public spaces list: the navbar, the landing and the space pages. */
  spaces: ['spaces'] as const,
  /** One space with its rooms and contact: the landing cards, the pricing block, the space page. */
  space: (id: string) => ['space', id] as const,
  /** The packs the pricing block offers for an organisation. */
  pricingPackages: (orgId: string) => ['pricing', 'packages', orgId] as const,
}
