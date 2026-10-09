'use client'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { FileText } from 'lucide-react'
import { authApi, invoicesApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { detailOf } from '@/lib/httpError'
import { saveBlob } from '@/lib/download'
import { nifError } from '@/lib/nif'
import { formatCurrency, formatHours } from '@/lib/utils'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { MyInvoice } from '@/types'

// I07: the customer's billing details (what a fatura to them names) and the
// invoices the operator registered for them, with the PDF when there is one.

const schema = z.object({
  tax_id: z.string().refine((v) => nifError(v) === null, { message: 'NIF inválido' }),
  billing_name: z.string().max(255, 'Demasiado longo'),
  billing_address: z.string().max(1000, 'Demasiado longo'),
})
type FormValues = z.infer<typeof schema>

function periodLabel(from: string, to: string): string {
  return `${format(parseISO(from), 'd MMM', { locale: pt })} – ${format(parseISO(to), 'd MMM yyyy', { locale: pt })}`
}

export default function BillingPage() {
  const { data: session } = useSession()
  const api = useApi()
  const qc = useQueryClient()
  // Inline, not a toast: the customer pages mount no toast region.
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const enabled = !!session?.accessToken

  const billing = useQuery({ queryKey: ['billing', 'me'], queryFn: () => authApi.getBilling(api), enabled })
  const invoices = useQuery({ queryKey: ['invoices', 'me'], queryFn: () => invoicesApi.listMine(api), enabled })

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { tax_id: '', billing_name: '', billing_address: '' } })
  useEffect(() => {
    if (billing.data) form.reset({ tax_id: billing.data.tax_id ?? '', billing_name: billing.data.billing_name ?? '', billing_address: billing.data.billing_address ?? '' })
  }, [billing.data, form])

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      authApi.updateBilling(
        {
          tax_id: values.tax_id.replace(/\s+/g, '') || null,
          billing_name: values.billing_name.trim() || null,
          billing_address: values.billing_address.trim() || null,
        },
        api,
      ),
    onMutate: () => setNotice(null),
    onSuccess: (data) => {
      qc.setQueryData(['billing', 'me'], data)
      setNotice({ kind: 'ok', text: 'Dados de faturação guardados.' })
    },
    onError: (err) => setNotice({ kind: 'error', text: detailOf(err) ?? 'Não foi possível guardar os dados.' }),
  })
  const download = useMutation({
    mutationFn: async (invoice: MyInvoice) =>
      saveBlob(await invoicesApi.downloadPdf(invoice.id, api), `fatura-${invoice.number.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`),
    onError: (err) => setNotice({ kind: 'error', text: detailOf(err) ?? 'Não foi possível transferir o PDF.' }),
  })

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-background">
        <div className="bg-white border-b border-border py-8">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h1 className="text-2xl font-bold text-foreground">Faturação</h1>
            <p className="text-muted-foreground mt-1 text-sm">Os dados que as suas faturas devem ter e as faturas emitidas em seu nome.</p>
          </div>
        </div>
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8 space-y-10">
          <section aria-labelledby="dados-faturacao">
            <h2 id="dados-faturacao" className="text-lg font-semibold text-foreground mb-3">Dados de faturação</h2>
            <Card>
              <CardContent className="p-5">
                {billing.isLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : (
                  <form className="space-y-4" onSubmit={form.handleSubmit((values) => save.mutate(values))} noValidate>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label htmlFor="tax_id">NIF</Label>
                        <Input id="tax_id" inputMode="numeric" placeholder="123456789" aria-invalid={!!form.formState.errors.tax_id} {...form.register('tax_id')} />
                        {form.formState.errors.tax_id ? (
                          <p role="alert" className="text-sm text-destructive">{form.formState.errors.tax_id.message}</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Nove dígitos. Em branco, a fatura é passada sem NIF.</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="billing_name">Nome de faturação</Label>
                        <Input id="billing_name" placeholder="Se diferente do nome da conta" {...form.register('billing_name')} />
                        {form.formState.errors.billing_name && <p role="alert" className="text-sm text-destructive">{form.formState.errors.billing_name.message}</p>}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="billing_address">Morada de faturação</Label>
                      <Textarea id="billing_address" rows={2} {...form.register('billing_address')} />
                      {form.formState.errors.billing_address && <p role="alert" className="text-sm text-destructive">{form.formState.errors.billing_address.message}</p>}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      {notice && (
                        <p role="status" className={`text-sm ${notice.kind === 'ok' ? 'text-primary' : 'text-destructive'}`}>{notice.text}</p>
                      )}
                      <Button type="submit" disabled={save.isPending}>{save.isPending ? 'A guardar…' : 'Guardar'}</Button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>
          </section>

          <section aria-labelledby="as-minhas-faturas">
            <h2 id="as-minhas-faturas" className="text-lg font-semibold text-foreground mb-3">As minhas faturas</h2>
            {invoices.isLoading ? (
              <Skeleton className="h-24 w-full rounded-xl" />
            ) : (invoices.data ?? []).length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <p>Ainda não tem faturas registadas.</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">As minhas faturas</caption>
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Nº</th>
                        <th className="px-4 py-3 font-medium">Data</th>
                        <th className="px-4 py-3 font-medium">Período</th>
                        <th className="px-4 py-3 font-medium text-right">Horas</th>
                        <th className="px-4 py-3 font-medium text-right">Valor</th>
                        <th className="px-4 py-3 font-medium text-right">PDF</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(invoices.data ?? []).map((invoice) => (
                        <tr key={invoice.id} data-testid="my-invoice">
                          <td className="px-4 py-3 font-medium text-foreground">{invoice.number}</td>
                          <td className="px-4 py-3 whitespace-nowrap">{format(parseISO(invoice.issued_at), 'd MMM yyyy', { locale: pt })}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{periodLabel(invoice.period_from, invoice.period_to)}</td>
                          <td className="px-4 py-3 text-right">{formatHours(Number(invoice.hours))}</td>
                          <td className="px-4 py-3 text-right font-medium text-foreground">{formatCurrency(Number(invoice.amount))}</td>
                          <td className="px-4 py-3 text-right">
                            {invoice.has_pdf ? (
                              <Button variant="ghost" size="sm" className="gap-1" onClick={() => download.mutate(invoice)} aria-label={`Transferir PDF ${invoice.number}`}>
                                <FileText className="h-4 w-4" /> Transferir
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">Sem PDF</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </section>
        </div>
      </main>
      <Footer />
    </>
  )
}
