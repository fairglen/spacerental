'use client'
import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { adminApi } from '@/lib/api'
import { useCrud } from '@/components/admin/crud/useCrud'
import { EntityForm, FormField, FormSection } from '@/components/admin/crud/EntityForm'
import { PageHeader } from '@/components/admin/crud/PageHeader'
import { Input } from '@/components/ui/input'

const schema = z
  .object({
    name: z.string().min(1, 'Nome obrigatório'),
    email: z.string().email('Email inválido'),
    mode: z.enum(['link', 'password']),
    password: z.string(),
    confirm: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.mode !== 'password') return
    if (v.password.length < 8) ctx.addIssue({ code: 'custom', path: ['password'], message: 'Pelo menos 8 caracteres' })
    if (v.password !== v.confirm) ctx.addIssue({ code: 'custom', path: ['confirm'], message: 'As passwords não coincidem' })
  })
type FormValues = z.infer<typeof schema>

/** Novo cliente (G06): the person gets a "Defina a sua password" link by default,
 * or the operator sets one now. */
export default function NewUserPage() {
  const router = useRouter()
  const { api, invalidate } = useCrud('users')
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: '', email: '', mode: 'link', password: '', confirm: '' } })
  const mode = form.watch('mode')
  const createdId = useRef<string | null>(null)

  return (
    <div className="p-8 pb-28 max-w-3xl">
      <PageHeader title="Novo cliente" crumbs={[{ label: 'Clientes', href: '/admin/users' }, { label: 'Novo' }]} description="Fica inscrito neste espaço como cliente." />
      <EntityForm
        form={form}
        submitLabel="Criar cliente"
        successMessage="Cliente criado."
        onCancel={() => router.push('/admin/users')}
        onSubmit={async (values) => {
          const user = await adminApi.createUser({ name: values.name, email: values.email, ...(values.mode === 'password' ? { password: values.password } : {}) }, api)
          createdId.current = user.id
        }}
        onSaved={async () => { await invalidate(); if (createdId.current) router.push(`/admin/users/${createdId.current}`) }}
      >
        <FormSection title="Conta">
          <FormField id="name" label="Nome" error={form.formState.errors.name?.message}><Input id="name" {...form.register('name')} autoComplete="off" /></FormField>
          <FormField id="email" label="Email" error={form.formState.errors.email?.message}><Input id="email" type="email" {...form.register('email')} autoComplete="off" /></FormField>
        </FormSection>
        <FormSection title="Acesso">
          <fieldset className="lg:col-span-2 space-y-2">
            <legend className="text-sm font-medium">Como define a password?</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" value="link" {...form.register('mode')} className="mt-1" />
              <span><strong>Enviar ligação para definir password</strong><span className="block text-muted-foreground">A pessoa recebe um email com uma ligação válida 60 minutos.</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" value="password" {...form.register('mode')} className="mt-1" />
              <span><strong>Definir password agora</strong><span className="block text-muted-foreground">Nenhum email é enviado; comunique-a à pessoa.</span></span>
            </label>
          </fieldset>
          {mode === 'password' && (
            <>
              <FormField id="password" label="Password" error={form.formState.errors.password?.message}><Input id="password" type="password" autoComplete="new-password" {...form.register('password')} /></FormField>
              <FormField id="confirm" label="Confirmar" error={form.formState.errors.confirm?.message}><Input id="confirm" type="password" autoComplete="new-password" {...form.register('confirm')} /></FormField>
            </>
          )}
        </FormSection>
      </EntityForm>
    </div>
  )
}
