import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { ArrowRight } from 'lucide-react'
import { formatCurrency, formatHours } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { BillingSummary } from '@/types'

// I03: the operator's month at a glance — what came in, by kind — read on
// the statement's basis (`paid_at`, Lisbon days) so it agrees with
// /admin/billing to the cent.

export function periodLabel(from: string, to: string): string {
  const start = parseISO(from)
  const end = parseISO(to)
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
  return sameMonth
    ? `${format(start, 'd', { locale: pt })}–${format(end, "d 'de' MMMM 'de' yyyy", { locale: pt })}`
    : `${format(start, "d 'de' MMM", { locale: pt })} – ${format(end, "d 'de' MMM 'de' yyyy", { locale: pt })}`
}

export function ThisMonthCard({
  summary,
  title = 'Este mês',
  showLink = true,
  testId = 'this-month',
}: {
  summary: BillingSummary
  title?: string
  showLink?: boolean
  testId?: string
}) {
  const packsSold = summary.pack_sales.reduce((n, p) => n + p.count, 0)
  const bookings = summary.hourly.count + summary.mixed.count + summary.manual.count
  const paidHours = Number(summary.hourly.hours) + Number(summary.mixed.hours) + Number(summary.manual.hours)
  return (
    <Card data-testid={testId}>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>{title}</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">{periodLabel(summary.from, summary.to)}</p>
        </div>
        {showLink && (
          <Link href="/admin/billing">
            <Button variant="ghost" size="sm" className="gap-1">Ver faturação <ArrowRight className="h-4 w-4" /></Button>
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {summary.transactions_count === 0 ? (
          <p className="text-sm text-muted-foreground">Ainda não há movimentos este mês.</p>
        ) : (
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-6 text-sm">
            <div>
              <dt className="text-muted-foreground">Recebido</dt>
              <dd className="text-2xl font-bold text-foreground mt-1">{formatCurrency(Number(summary.received_total))}</dd>
              <dd className="text-xs text-muted-foreground mt-1">
                {summary.transactions_count} {summary.transactions_count === 1 ? 'transação' : 'transações'}
                {Number(summary.by_channel.manual) > 0 && ` · ${formatCurrency(Number(summary.by_channel.manual))} fora da plataforma`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Packs vendidos</dt>
              <dd className="text-2xl font-bold text-foreground mt-1">{packsSold}</dd>
              {summary.pack_sales.length > 0 && (
                <dd className="text-xs text-muted-foreground mt-1">
                  {summary.pack_sales.map((p) => `${p.name} × ${p.count}`).join(' · ')}
                </dd>
              )}
            </div>
            <div>
              <dt className="text-muted-foreground">Reservas à hora</dt>
              <dd className="text-2xl font-bold text-foreground mt-1">{bookings}</dd>
              <dd className="text-xs text-muted-foreground mt-1">
                {formatHours(paidHours)} pagas
                {summary.mixed.count > 0 && ` · ${summary.mixed.count} com pack`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Por faturar</dt>
              <dd className="text-2xl font-bold text-foreground mt-1">{formatCurrency(Number(summary.pending_amount))}</dd>
              <dd className="text-xs text-muted-foreground mt-1">faturado {formatCurrency(Number(summary.invoiced_amount))}</dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  )
}
