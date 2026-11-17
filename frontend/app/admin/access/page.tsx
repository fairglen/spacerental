'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { adminApi } from '@/lib/api'
import { useCrud } from '@/components/admin/crud/useCrud'
import { PageHeader } from '@/components/admin/crud/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

/** Acessos (L02): the week's door verdicts, anomalies in the open. */
const VERDICT_LABEL: Record<string, string> = {
  on_time: 'A horas',
  early: 'Antecipado',
  late: 'Atrasado',
  overstay: 'Permanência extra',
  no_booking: 'Sem reserva',
}
const ANOMALY = new Set(['late', 'overstay', 'no_booking'])

function verdictVariant(v: string): 'default' | 'secondary' | 'destructive' {
  if (ANOMALY.has(v)) return 'destructive'
  if (v === 'early') return 'secondary'
  return 'default'
}

function fmt(iso: string | null): string {
  return iso ? format(parseISO(iso), 'd MMM, HH:mm', { locale: pt }) : '—'
}

export default function AdminAccessPage() {
  const { api, enabled, currentOrgId } = useCrud('access')
  const [week, setWeek] = useState<string>('')
  const report = useQuery({
    queryKey: ['admin', 'access-report', currentOrgId, week],
    queryFn: () => adminApi.getAccessReport(week || undefined, api),
    enabled,
  })

  return (
    <div>
      <PageHeader title="Acessos" description="As utilizações da porta desta semana, com as anomalias em destaque." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted-foreground" htmlFor="week">Semana de</label>
        <input
          id="week"
          type="date"
          value={week}
          onChange={(e) => setWeek(e.target.value)}
          className="rounded-md border border-border bg-white px-2 py-1 text-sm"
        />
      </div>

      {report.isLoading && <Skeleton className="h-40 rounded-lg" />}
      {report.isError && <p role="alert" className="text-sm text-red-600">Não foi possível obter o relatório.</p>}
      {report.data && (
        <>
          <div className="mb-4 flex flex-wrap gap-2" data-testid="access-report-counts">
            {Object.entries(report.data.counts).map(([v, n]) => (
              <Badge key={v} variant={verdictVariant(v)}>{VERDICT_LABEL[v] ?? v}: {n}</Badge>
            ))}
            {Object.keys(report.data.counts).length === 0 && (
              <p className="text-sm text-muted-foreground">Sem acessos registados nesta semana.</p>
            )}
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-white">
            <table className="w-full text-sm">
              <caption className="sr-only">Verdictos de acesso da semana</caption>
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="p-3 font-medium">Entrada</th>
                  <th className="p-3 font-medium">Cliente</th>
                  <th className="p-3 font-medium">Verdicto</th>
                  <th className="p-3 font-medium">Saída (estimada)</th>
                </tr>
              </thead>
              <tbody>
                {report.data.verdicts.map((v, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="p-3">{fmt(v.entered_at)}</td>
                    <td className="p-3">{v.customer_name ?? v.customer_email ?? '—'}</td>
                    <td className="p-3">
                      <Badge variant={verdictVariant(v.verdict)}>{VERDICT_LABEL[v.verdict] ?? v.verdict}</Badge>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {v.departure_estimate_at
                        ? `~${fmt(v.departure_estimate_at)}${v.departure_confidence === 'low' ? ' (incerta)' : ''}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
