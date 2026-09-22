import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { Check, X, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Booking } from '@/types'
import { formatCurrency, formatHours, packSplitLines, STATUS_COLORS, STATUS_LABELS } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

interface BookingsTableProps {
  bookings: Booking[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onUpdateStatus?: (id: string, status: Booking['status']) => void
}

export function BookingsTable({
  bookings, total, page, pageSize, onPageChange, onUpdateStatus,
}: BookingsTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const showPager = total > pageSize

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-background border-b border-border">
              <tr>
                {['Data/Hora', 'Sala', 'Utilizador', 'Duração', 'Valor', 'Estado', 'Ações'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {bookings.map((b) => (
                <tr key={b.id} className="hover:bg-background">
                  <td className="px-4 py-3 text-foreground">{format(parseISO(b.start_time), "d MMM, HH:mm", { locale: pt })}</td>
                  <td className="px-4 py-3 text-muted-foreground">{b.room?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{b.user?.email ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{b.duration_hours}h</td>
                  <td className="px-4 py-3 font-medium text-foreground">
                    {b.payment_method === 'package' ? formatHours(b.duration_hours) + ' do pack' : formatCurrency(b.total_amount)}
                    {/* C13: the money is only part of a mixed booking's price. */}
                    {b.payment_method === 'mixed' && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        + {formatHours(b.package_hours_used ?? 0)} do pack
                      </span>
                    )}
                    {/* H02: which packs, on hover. */}
                    {(b.package_debits?.length ?? 0) > 0 && (
                      <span
                        className="block text-xs font-normal text-muted-foreground underline decoration-dotted cursor-help"
                        title={packSplitLines(b.package_debits).join('\n')}
                      >
                        {b.package_debits!.length === 1 ? '1 pack' : `de ${b.package_debits!.length} packs`}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3"><Badge className={STATUS_COLORS[b.status]}>{STATUS_LABELS[b.status]}</Badge></td>
                  <td className="px-4 py-3">
                    {b.status === 'pending' && onUpdateStatus && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-green-600"
                          aria-label="Confirmar reserva"
                          onClick={() => onUpdateStatus(b.id, 'confirmed')}>
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500"
                          aria-label="Cancelar reserva"
                          onClick={() => onUpdateStatus(b.id, 'cancelled')}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {showPager && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Página {page} de {totalPages} · {total} reservas
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Anterior
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
              >
                Seguinte <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
