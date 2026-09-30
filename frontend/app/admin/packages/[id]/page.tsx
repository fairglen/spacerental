'use client'
import { useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { adminApi } from '@/lib/api'
import { useCrud } from '@/components/admin/crud/useCrud'
import { EntityForm, FormField, FormSection } from '@/components/admin/crud/EntityForm'
import { DangerZone } from '@/components/admin/crud/DangerZone'
import { HistoryPanel } from '@/components/admin/crud/HistoryPanel'
import { PageHeader } from '@/components/admin/crud/PageHeader'
import { useToast } from '@/components/ui/toast'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatHours } from '@/lib/utils'
import { packageSchema, packageToForm, type PackageFormValues } from '@/lib/admin/packageForm'
import type { Package } from '@/types'

/** One pack (G06): the form, purchase counts, DangerZone, Histórico. */
export default function AdminPackagePage() {
  const { id } = useParams<{ id: string }>()
  const { currentOrgId } = useCrud('packages')
  return <PackageDetail key={`${currentOrgId}-${id}`} packageId={id} />
}

function PackageDetail({ packageId }: { packageId: string }) {
  const router = useRouter()
  const { api, enabled, currentOrgId, invalidate } = useCrud('packages')
  const { toast } = useToast()
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin', 'packages', currentOrgId, packageId], queryFn: () => adminApi.getPackage(packageId, api), enabled })
  const form = useForm<PackageFormValues>({ resolver: zodResolver(packageSchema) })
  useEffect(() => { if (data) form.reset(packageToForm(data.package)) }, [data, form])
  if (isLoading) return <div className="p-8"><Skeleton className="h-64 rounded-xl" /></div>
  if (isError || !data) return <div className="p-8"><p role="alert" className="text-sm text-red-600">Não foi possível carregar este pack. <Link href="/admin/packages" className="underline">Voltar à lista</Link>.</p></div>
  const pkg = data.package
  const e = form.formState.errors
  return (
    <div className="p-8 pb-28 max-w-4xl">
      <PageHeader
        title={pkg.name}
        crumbs={[{ label: 'Pacotes', href: '/admin/packages' }, { label: pkg.name }]}
        badge={<Badge variant={pkg.is_active ? 'default' : 'secondary'}>{pkg.is_active ? 'À venda' : 'Inativo'}</Badge>}
        description={`${data.purchases.total} compra(s), ${data.purchases.active} com horas por gastar · ${formatHours(data.hours_outstanding)} em aberto`}
      />
      <EntityForm form={form} successMessage="Pack guardado." onCancel={() => router.push('/admin/packages')} onSubmit={(values) => adminApi.updatePackage(packageId, values as Partial<Package>, api)} onSaved={() => invalidate(packageId)}>
        <FormSection title="Pack" description="Alterar o preço ou as horas não muda as compras já feitas.">
          <FormField id="name" label="Nome" error={e.name?.message}><Input id="name" {...form.register('name')} /></FormField>
          <FormField id="hours" label="Horas" error={e.hours?.message}><Input id="hours" type="number" {...form.register('hours')} /></FormField>
          <FormField id="price" label="Preço (€)" error={e.price?.message}><Input id="price" type="number" step="0.01" {...form.register('price')} /></FormField>
          <FormField id="validity_days" label="Validade (dias)" error={e.validity_days?.message}><Input id="validity_days" type="number" {...form.register('validity_days')} /></FormField>
        </FormSection>
      </EntityForm>
      <div className="space-y-6 mt-8">
        <DangerZone
          entityLabel="pack"
          name={pkg.name}
          shortId={pkg.id.replace(/-/g, '').slice(0, 8)}
          keeps="Desativar tira o pack da venda; as compras já feitas continuam válidas. Eliminar só é possível para um pack que nunca foi comprado nem oferecido."
          soft={{ active: pkg.is_active, onToggle: () => adminApi.updatePackage(packageId, { is_active: !pkg.is_active }, api), activeLabel: 'Retirar da venda', inactiveLabel: 'Voltar a vender' }}
          hard={{ onDelete: async (confirm) => { await adminApi.deletePackage(packageId, confirm, api); toast({ title: 'Pack eliminado.', variant: 'success' }); await invalidate(); router.push('/admin/packages') } }}
          onDone={() => invalidate(packageId)}
        />
        <HistoryPanel entity="packages" id={packageId} />
      </div>
    </div>
  )
}
