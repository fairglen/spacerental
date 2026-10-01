'use client'
import Link from 'next/link'
import { X } from 'lucide-react'

export type PaymentOutcome = 'sucesso' | 'cancelado'

/** The `?pagamento=` query Stripe/stub checkout returns with, or null. */
export function paymentOutcomeOf(value: string | null): PaymentOutcome | null {
  return value === 'sucesso' || value === 'cancelado' ? value : null
}

interface PaymentNoticeProps {
  outcome: PaymentOutcome
  onClose: () => void
  /** Where the customer landed: the dashboard (B25) or the booking page they left to buy a pack (K02). */
  context?: 'dashboard' | 'booking'
}

/** The dismissible notice shown once after returning from Checkout (B25, K02). */
export function PaymentNotice({ outcome, onClose, context = 'dashboard' }: PaymentNoticeProps) {
  return (
    <div
      role="status"
      className={
        outcome === 'sucesso'
          ? 'mb-6 flex items-start justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900'
          : 'mb-6 flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900'
      }
    >
      <p>
        {context === 'booking' ? (
          outcome === 'sucesso' ? (
            <>
              <span className="font-semibold">Pagamento concluído.</span> O pack fica disponível de imediato
              (normalmente). Confirme a reserva abaixo com as horas do pack.
            </>
          ) : (
            <>
              <span className="font-semibold">Pagamento não concluído.</span> Não foi cobrado nada. Pode confirmar
              a reserva abaixo de outra forma ou tentar comprar o pack de novo.
            </>
          )
        ) : outcome === 'sucesso' ? (
          <>
            <span className="font-semibold">Pagamento concluído.</span> Obrigado! Uma reserva aparece
            abaixo como confirmada assim que o pagamento for processado (normalmente de imediato); um pack
            fica disponível em{' '}
            <Link href="/dashboard/packages" className="font-medium underline">Os meus packs</Link>.
          </>
        ) : (
          <>
            <span className="font-semibold">Pagamento não concluído.</span> Não foi cobrado nada.
            Se era uma reserva, o seu estado atual aparece abaixo; se era um pack, pode voltar a comprá-lo em{' '}
            <Link href="/dashboard/packages" className="font-medium underline">Os meus packs</Link>.
          </>
        )}
      </p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar aviso"
        className="shrink-0 rounded p-1 hover:bg-black/5"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
