'use client'
import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { adminApi } from '@/lib/api'
import { useCrud } from '@/components/admin/crud/useCrud'
import { EntityForm, FormField, FormSection } from '@/components/admin/crud/EntityForm'
import { PageHeader } from '@/components/admin/crud/PageHeader'
import { Input } from '@/components/ui/input'
import { packageSchema, type PackageFormValues } from '@/lib/admin/packageForm'
import type { Package } from '@/types'

export default function NewPackagePage() {
  const router = useRouter()
  const { api, invalidate } = useCrud('packages')
  const form = useForm<PackageFormValues>({ resolver: zodResolver(packageSchema), defaultValues: { name: '', hours: 10, price: 100, validity_days: 365 } })
  const created = useRef<string | null>(null)
  return (
    <div className="p-8 pb-28 max-w-3xl">
      <PageHeader title="Novo pack" crumbs={[{ label: 'Pacotes', href: '/admin/packages' }, { label: 'Novo' }]} />
      <EntityForm
        form={form}
        submitLabel="Criar pack"
        successMessage="Pack criado."
        onCancel={() => router.push('/admin/packages')}
        onSubmit={async (values) => { const p = await adminApi.createPackage(values as Partial<Package>, api); created.current = p.id }}
        onSaved={async () => { await invalidate(); router.push(created.current ? `/admin/packages/${created.current}` : '/admin/packages') }}
      >
        <PackageFields form={form} />
      </EntityForm>
    </div>
  )
}

function PackageFields({ form }: { form: ReturnType<typeof useForm<PackageFormValues>> }) {
  const e = form.formState.errors
  return (
    <FormSection title="Pack">
      <FormField id="name" label="Nome" error={e.name?.message}><Input id="name" {...form.register('name')} /></FormField>
      <FormField id="hours" label="Horas" error={e.hours?.message}><Input id="hours" type="number" {...form.register('hours')} /></FormField>
      <FormField id="price" label="Preço (€)" error={e.price?.message}><Input id="price" type="number" step="0.01" {...form.register('price')} /></FormField>
      <FormField id="validity_days" label="Validade (dias)" error={e.validity_days?.message}><Input id="validity_days" type="number" {...form.register('validity_days')} /></FormField>
    </FormSection>
  )
}
