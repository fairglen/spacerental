'use client'
import { format } from 'date-fns'
import { pt } from 'date-fns/locale'
import { formatCurrency, formatHours } from '@/lib/utils'
import type { PaymentPlan as Plan } from '@/lib/paymentSplit'
import type { Room } from '@/types'

interface PaymentPlanProps {
  room: Room
  start: Date
  end: Date
  duration: number
  total: number
  plan: Plan
  usesPack: boolean
  paidHours: number
  amountDue: number
  repeatWeekly: boolean
  occurrences: Date[]
}

/**
 * The summary box of the booking modal (Q51): room, date, hours, and what is
 * paid with pack hours versus money (C13/H02), or the plain total.
 */
export function PaymentPlan({ room, start, end, duration, total, plan, usesPack, paidHours, amountDue, repeatWeekly, occurrences }: PaymentPlanProps) {
  return (
    <div className="rounded-lg bg-accent p-4 space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Sala</span>
        <span className="font-medium text-foreground">{room.name}</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Data</span>
        <span className="font-medium text-foreground">{format(start, "d 'de' MMMM 'de' yyyy", { locale: pt })}</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Horário</span>
        <span className="font-medium text-foreground">{format(start, 'HH:mm')} – {format(end, 'HH:mm')}</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Duração</span>
        <span className="font-medium text-foreground">{duration}h</span>
      </div>
      {plan.kind === 'none' ? (
        <div className="border-t border-primary-light pt-2 flex justify-between">
          <span className="font-semibold text-foreground">{repeatWeekly ? 'Total por semana' : 'Total'}</span>
          <span className="font-bold text-primary text-lg">{formatCurrency(total)}</span>
        </div>
      ) : (
        // C13: whoever has pack hours sees where they go and what is left
        // to pay, before confirming — never a surprise at Checkout.
        <div role="group" aria-label="Resumo do pagamento" className="border-t border-primary-light pt-2 space-y-1">
          <span className="sr-only">Duração {formatHours(duration)}</span>
          {usesPack && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Horas do pack</span>
              <span className="font-medium text-foreground">
                − {formatHours(plan.packHours)}
                {/* H02: the bank spans packs; say so when this block does. */}
                {plan.packsUsed > 1 && <span className="font-normal text-muted-foreground"> (de {plan.packsUsed} packs)</span>}{' '}
                <span className="font-normal text-muted-foreground">(ficam {formatHours(plan.hoursLeftAfter)})</span>
              </span>
            </div>
          )}
          <div className="flex justify-between items-baseline">
            <span className="font-semibold text-foreground">A pagar agora</span>
            <span className="font-bold text-primary text-lg">
              {paidHours > 0 && (
                <span className="mr-1 text-sm font-normal text-muted-foreground">
                  {formatHours(paidHours)} × {formatCurrency(room.hourly_rate)} ={' '}
                </span>
              )}
              {formatCurrency(amountDue)}
            </span>
          </div>
        </div>
      )}
      {repeatWeekly && occurrences.length > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Total da série ({occurrences.length} reservas)</span>
          <span className="font-medium text-foreground">{formatCurrency(total * occurrences.length)}</span>
        </div>
      )}
    </div>
  )
}
