'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { type FieldValues, type Path, type UseFormReturn } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'
import { blockerLines, parseApiError, type FormApiError } from './apiErrors'

/**
 * The shared form frame (G05): sections in two columns from 1024 px, inline
 * field errors from a 422, a banner (with blockers) from a 409 or anything
 * else, a sticky bottom bar whose "Guardar" is disabled until dirty, an
 * unsaved-changes guard (beforeunload + in-app links), a success toast, and
 * a refetch after save — never an optimistic write.
 */
export type EntityFormProps<T extends FieldValues> = {
  form: UseFormReturn<T>
  onSubmit: (values: T) => Promise<unknown>
  onSaved?: () => void | Promise<void>
  onCancel?: () => void
  successMessage?: string
  submitLabel?: string
  children: ReactNode
  /** Extra buttons on the bar's left (e.g. "Eliminar") */
  extra?: ReactNode
}

export function useUnsavedGuard(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return
    const message = 'Tem alterações por guardar. Sair sem guardar?'
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = message }
    // The App Router has no route events: intercept in-app links at the
    // document instead, before Next's own click handler gets them.
    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!link || link.target === '_blank' || e.defaultPrevented) return
      if (link.href === window.location.href) return
      if (!window.confirm(message)) { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('beforeunload', onUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [isDirty])
}

export function EntityForm<T extends FieldValues>({
  form, onSubmit, onSaved, onCancel, successMessage = 'Guardado.', submitLabel = 'Guardar', children, extra,
}: EntityFormProps<T>) {
  const router = useRouter()
  const { toast } = useToast()
  const [error, setError] = useState<FormApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const { isDirty } = form.formState
  useUnsavedGuard(isDirty && !busy)
  const cancelled = useRef(false)

  const submit = form.handleSubmit(async (values) => {
    setBusy(true)
    setError(null)
    try {
      await onSubmit(values)
      // Reset to what was just saved so the guard and the bar see a clean form.
      form.reset(values)
      toast({ title: successMessage, variant: 'success' })
      await onSaved?.()
    } catch (err) {
      const parsed = parseApiError(err)
      for (const [field, message] of Object.entries(parsed.fields)) {
        form.setError(field as Path<T>, { type: 'server', message })
      }
      setError(parsed)
    } finally {
      setBusy(false)
    }
  })

  function cancel() {
    cancelled.current = true
    if (onCancel) onCancel()
    else router.back()
  }

  return (
    <form onSubmit={submit} noValidate className="relative">
      <div className="space-y-8">{children}</div>
      {error?.message && (
        <div role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">{error.message}</p>
          {blockerLines(error.blockers).length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {blockerLines(error.blockers).map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
        </div>
      )}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-white/95 backdrop-blur-sm px-4 py-3 md:left-64">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div>{extra}</div>
          <div className="flex items-center gap-2">
            {isDirty && <span className="text-xs text-muted-foreground hidden sm:inline">Alterações por guardar</span>}
            <Button type="button" variant="outline" onClick={cancel} disabled={busy}>Cancelar</Button>
            <Button type="submit" disabled={!isDirty || busy}>{busy ? 'A guardar…' : submitLabel}</Button>
          </div>
        </div>
      </div>
    </form>
  )
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`section-${slug(title)}`} className="rounded-xl border border-border bg-white p-5">
      <h2 id={`section-${slug(title)}`} className="text-base font-semibold text-foreground">{title}</h2>
      {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">{children}</div>
    </section>
  )
}

export function FormField({ id, label, error, hint, children, full }: { id: string; label: string; error?: string; hint?: string; children: ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'lg:col-span-2' : undefined}>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1">{children}</div>
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-muted-foreground mt-1">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}

function slug(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-')
}
