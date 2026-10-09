'use client'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { adminApi } from '@/lib/api'
import { useOrg } from '@/contexts/OrgContext'
import { useCrud } from '@/components/admin/crud/useCrud'
import { EntityForm, FormField, FormSection } from '@/components/admin/crud/EntityForm'
import Link from 'next/link'
import { PageHeader } from '@/components/admin/crud/PageHeader'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { CONTACT_EMAIL } from '@/lib/contact'
import { EmailStatusCard } from '@/components/admin/EmailStatusCard'

const schema = z.object({
  name: z.string().min(2, 'Nome obrigatório'),
  contact_email: z.string().email('Email inválido').or(z.literal('')),
  contact_phone: z.string().max(40, 'Demasiado longo'),
  timezone: z.string().min(1, 'Fuso horário obrigatório'),
})
type FormValues = z.infer<typeof schema>

/** Definições (G06): the organisation's settings — the owner edits, admins read. */
export default function AdminSettingsPage() {
  const { currentOrgId } = useCrud('organization')
  return <Settings key={currentOrgId} />
}

function Settings() {
  const { api, enabled, currentOrgId, invalidate } = useCrud('organization')
  const { currentMembership } = useOrg()
  const isOwner = currentMembership?.role === 'owner'
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin', 'organization', currentOrgId], queryFn: () => adminApi.getOrganization(api), enabled })
  const form = useForm<FormValues>({ resolver: zodResolver(schema) })
  useEffect(() => {
    if (data) form.reset({ name: data.name, contact_email: data.contact_email ?? '', contact_phone: data.contact_phone ?? '', timezone: data.timezone })
  }, [data, form])
  if (isLoading) return <div className="p-8"><Skeleton className="h-64 rounded-xl" /></div>
  if (isError || !data) return <div className="p-8"><p role="alert" className="text-sm text-red-600">Não foi possível carregar as definições.</p></div>
  return (
    <div className="p-8 pb-28 max-w-4xl">
      <PageHeader title="Definições" description={`Organização ${data.slug} · plano ${data.plan}`} />
      {!isOwner && (
        <p role="status" className="mb-4 rounded-lg border border-border bg-[#F8FAF9] px-4 py-3 text-sm text-muted-foreground">
          Só o proprietário do espaço pode alterar estas definições. Pode consultá-las.
        </p>
      )}
      <EntityForm
        form={form}
        successMessage="Definições guardadas."
        onCancel={() => form.reset()}
        onSubmit={(values) => adminApi.updateOrganization({
          name: values.name,
          contact_email: values.contact_email.trim() || null,
          contact_phone: values.contact_phone.trim() || null,
          timezone: values.timezone,
        }, api)}
        onSaved={() => invalidate()}
      >
        <FormSection title="Organização">
          <FormField id="name" label="Nome" error={form.formState.errors.name?.message}><Input id="name" {...form.register('name')} disabled={!isOwner} /></FormField>
          <FormField id="slug" label="Identificador" hint="Só de leitura."><Input id="slug" value={data.slug} readOnly disabled /></FormField>
        </FormSection>
        <FormSection title="Contacto público" description={`O que os clientes veem em "Onde estamos" e no rodapé. Em branco, mantém-se ${CONTACT_EMAIL}.`}>
          <FormField id="contact_email" label="Email de contacto" error={form.formState.errors.contact_email?.message}><Input id="contact_email" type="email" {...form.register('contact_email')} placeholder={CONTACT_EMAIL} disabled={!isOwner} /></FormField>
          <FormField id="contact_phone" label="Telefone" hint="Opcional." error={form.formState.errors.contact_phone?.message}><Input id="contact_phone" {...form.register('contact_phone')} disabled={!isOwner} /></FormField>
        </FormSection>
        <FormSection title="Fuso horário" description="O relógio por omissão dos horários de funcionamento.">
          <FormField id="timezone" label="Fuso horário" hint="Nome IANA, por exemplo Europe/Lisbon." error={form.formState.errors.timezone?.message}><Input id="timezone" {...form.register('timezone')} disabled={!isOwner} /></FormField>
        </FormSection>
      </EntityForm>
      <p className="mt-8 text-sm"><Link href="/admin/audit?entity_type=organization" className="text-primary underline">Ver o histórico das definições</Link></p>
      {/* B61: the email gateway's state and a test send — admins and the owner alike. */}
      <EmailStatusCard api={api} enabled={enabled} orgId={currentOrgId} />
    </div>
  )
}
