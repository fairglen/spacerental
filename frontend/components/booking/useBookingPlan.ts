'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { packagesApi, createAuthenticatedApi } from '@/lib/api'
import { paymentOptions, planPayment } from '@/lib/paymentSplit'
import { slotReturnPath } from '@/lib/bookingDeepLink'
import { PACK_SETTLE_POLL_MS, PACK_SETTLE_WAIT_MS } from '@/lib/packSettle'
import type { Room } from '@/types'

export type PaymentMethod = 'hourly' | 'package' | 'mixed'
// The customer's choice is "my pack", "money for everything" or, when the
// bank cannot cover the block, "buy a pack first" (K02); whether "my pack"
// means `package` or `mixed` follows from what the pack can cover.
export type PaymentChoice = 'pack' | 'hourly' | 'buy'

/**
 * Everything the booking modal knows about paying for the block (Q51): the
 * customer's bank, the plan the pack allows (C13/H02), the choices on offer
 * (K02), the chosen one and what it makes of the method and the amount, plus
 * the pack purchase that leaves for Checkout. A new slot forgets the choice.
 *
 * `awaitingPurchase` (K02 review on #69): the customer is back from buying a
 * pack for this slot. The purchase may still be `pending` — Stripe activates
 * it from its webhook, which can land after the customer does — so the bank
 * is polled for a bounded while and the choice withheld until it shows up.
 */
export function useBookingPlan({ room, start, end, repeatWeekly, awaitingPurchase = false }: { room: Room | null; start: Date | null; end: Date | null; repeatWeekly: boolean; awaitingPurchase?: boolean }) {
  const { data: session, status } = useSession()
  const pathname = usePathname()
  const queryClient = useQueryClient()
  // null until the user picks — the default depends on data that arrives later.
  const [choice, setChoice] = useState<PaymentChoice | null>(null)

  const duration = start && end ? (end.getTime() - start.getTime()) / (1000 * 60 * 60) : 0
  const total = room ? duration * room.hourly_rate : 0
  // While a just-bought pack is awaited the bank is polled until it holds
  // spendable hours or the wait runs out; "Verificar de novo" re-arms it.
  const [settleTimedOut, setSettleTimedOut] = useState(false)
  const [settleRound, setSettleRound] = useState(0)
  const { data: purchases = [], isSuccess: purchasesLoaded, isError: purchasesFailed } = useQuery({
    queryKey: ['packages', 'me'],
    queryFn: () => packagesApi.listMine(createAuthenticatedApi(session?.accessToken)),
    enabled: status === 'authenticated',
    refetchInterval: (query) => {
      if (!awaitingPurchase || settleTimedOut || !room) return false
      return planPayment(query.state.data ?? [], room.org_id, duration).kind === 'none' ? PACK_SETTLE_POLL_MS : false
    },
  })

  // What the pack can do for this block (C13): pay for all of it, for part of
  // it, or nothing. A preview of the server's own computation — see
  // `lib/paymentSplit.ts`.
  const plan = room && !repeatWeekly ? planPayment(purchases, room.org_id, duration) : ({ kind: 'none' } as const)
  const canPayWithPackage = plan.kind === 'full'
  // Until the awaited pack shows up, confirming would charge the block by the
  // hour on top of the pack just paid for: the choice is withheld and the
  // customer told the payment is being confirmed. Past the bound (or if the
  // bank cannot be read) they are told that instead and get the choice back.
  const packSettled = plan.kind !== 'none'
  const waitingForPack = awaitingPurchase && !packSettled && !settleTimedOut && !purchasesFailed
  const packUnconfirmed = awaitingPurchase && !packSettled && (settleTimedOut || purchasesFailed)
  useEffect(() => {
    if (!awaitingPurchase || packSettled) return
    setSettleTimedOut(false)
    const timer = setTimeout(() => setSettleTimedOut(true), PACK_SETTLE_WAIT_MS)
    return () => clearTimeout(timer)
  }, [awaitingPurchase, packSettled, settleRound])
  const checkBankAgain = () => {
    setSettleRound((round) => round + 1)
    queryClient.invalidateQueries({ queryKey: ['packages', 'me'] })
  }
  // K02: the choices on offer, in order; "buy" only while the bank falls short.
  const options = room && !repeatWeekly ? paymentOptions(plan, purchases.length > 0) : []
  const buying = options.includes('buy') && choice === 'buy'
  // Default to spending hours the customer has already paid for — charging them
  // again while a valid pack sits unused is the wrong way round. Falls back to
  // hourly when there is no usable pack. Re-derived on every render, so a
  // longer block the hours no longer cover becomes pack-plus-money by itself.
  const usesPack = plan.kind !== 'none' && (choice ?? 'pack') === 'pack'
  const effectiveMethod: PaymentMethod = !usesPack ? 'hourly' : plan.kind === 'full' ? 'package' : 'mixed'
  // The packs a customer may buy here (K02), fetched only once "buy" is on offer.
  const { data: packages = [] } = useQuery({
    queryKey: ['packages', room?.org_id],
    queryFn: () => packagesApi.list(room!.org_id),
    enabled: !!room && purchasesLoaded && options.includes('buy'),
  })
  const purchase = useMutation({
    mutationFn: async (packageId: string) => {
      if (!room || !start || !end) throw new Error('Missing data')
      const api = createAuthenticatedApi(session?.accessToken)
      // Back to this slot after Checkout, with the outcome in the query.
      const result = await packagesApi.purchase(packageId, room.org_id, api, slotReturnPath(pathname, room.id, start, end))
      if (!result.checkout_url) throw new Error('Purchase created without a checkout_url')
      return result
    },
    onSuccess: ({ checkout_url }) => {
      queryClient.invalidateQueries({ queryKey: ['packages', 'me'] })
      window.location.assign(checkout_url)
    },
  })
  const hoursLeft = plan.kind === 'none' ? 0 : plan.packHours + plan.hoursLeftAfter
  const paidHours = usesPack ? plan.paidHours : duration
  const amountDue = room ? paidHours * room.hourly_rate : 0

  // A fresh slot selection should not inherit the previous one's payment
  // choice: a "Comprar um pack" left over would reopen the pack list on the
  // next slot — or, once the bank covers the new block and that option is
  // gone, would silently land on paying again (review on #69). Back to the
  // data-derived default instead; `end` too, since the same start with
  // another end is another block with another plan behind the choice.
  useEffect(() => {
    setChoice(null)
    purchase.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end])

  return {
    session, status, pathname, queryClient,
    duration, total, purchases,
    plan, canPayWithPackage, options, buying, usesPack, effectiveMethod,
    packages, purchase, hoursLeft, paidHours, amountDue,
    choice, setChoice,
    waitingForPack, packUnconfirmed, checkBankAgain,
  }
}
