'use client'
import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { format, isPast, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { bookingsApi, createAuthenticatedApi, supportApi } from '@/lib/api'
import { statusOf } from '@/lib/httpError'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { SupportCategory, SupportRequestBody } from '@/types'

interface HelpDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Presets from whoever opened it; not URL state, so a reload forgets them. */
  initialCategory?: SupportCategory
  initialBookingId?: string
}

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  technical: 'Problema técnico',
  booking: 'Reserva',
  payment: 'Pagamento',
  package: 'Pack',
  other: 'Outro',
}

const MIN_MESSAGE = 20
const MAX_MESSAGE = 2000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Baked in at build time by next.config.js; "dev" when nothing is set.
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'dev'

function submitErrorMessage(error: unknown): string {
  switch (statusOf(error)) {
    case 401: return 'A sua sessão expirou. Entre de novo, ou envie sem sessão iniciada com o seu email.'
    case 404: return 'Essa reserva já não existe. Escolha outra ou envie sem reserva.'
    case 422: return 'Verifique os campos: a mensagem precisa de 20 a 2000 caracteres e o email de ser válido.'
    case 429: return 'Demasiados pedidos seguidos. Aguarde um momento e tente de novo.'
    case undefined: return 'Sem ligação ao servidor. Verifique a internet e tente novamente.'
    default: return 'Não foi possível enviar o pedido. Tente novamente daqui a pouco.'
  }
}

/**
 * "Ajuda" — report a problem or ask a question (C17). The request is stored
 * for the operator and emailed to the support address; the customer gets a
 * reference and an answer by email. Not a chat, not a widget.
 */
export function HelpDialog({ open, onOpenChange, initialCategory, initialBookingId }: HelpDialogProps) {
  const { data: session, status } = useSession()
  const signedIn = status === 'authenticated'
  const api = useMemo(() => createAuthenticatedApi(session?.accessToken), [session?.accessToken])

  const [category, setCategory] = useState<SupportCategory>(initialCategory ?? 'technical')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [bookingId, setBookingId] = useState(initialBookingId ?? '')
  const [website, setWebsite] = useState('')
  const [errors, setErrors] = useState<{ message?: string; email?: string }>({})

  // A customer's bookings, so they can point at one: only those still ahead.
  const { data: bookings = [] } = useQuery({
    queryKey: ['bookings', 'me'],
    queryFn: () => bookingsApi.listMine(api),
    enabled: signedIn && open,
  })
  const upcoming = bookings.filter((b) => !isPast(parseISO(b.end_time)) && b.status !== 'cancelled')
  // The preset may name a booking the list has not arrived with yet; keep it
  // only if it turns out to be one of theirs.
  useEffect(() => {
    if (bookingId && bookings.length > 0 && !upcoming.some((b) => b.id === bookingId)) setBookingId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings])

  const mutation = useMutation({
    mutationFn: (body: SupportRequestBody) => supportApi.create(body, signedIn ? api : undefined),
  })

  function validate(): boolean {
    const next: typeof errors = {}
    const trimmed = message.trim()
    if (trimmed.length < MIN_MESSAGE) next.message = `Escreva pelo menos ${MIN_MESSAGE} caracteres.`
    else if (trimmed.length > MAX_MESSAGE) next.message = `No máximo ${MAX_MESSAGE} caracteres.`
    if (!signedIn && !EMAIL_PATTERN.test(email.trim())) next.email = 'Indique um email válido para lhe respondermos.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function submit() {
    if (!validate()) return
    mutation.mutate({
      category,
      message: message.trim(),
      ...(signedIn ? {} : { contact_email: email.trim() }),
      ...(signedIn && bookingId ? { booking_id: bookingId } : {}),
      context: {
        page_url: window.location.href,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        user_agent: navigator.userAgent,
        app_version: APP_VERSION,
        timestamp: new Date().toISOString(),
      },
      website,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-labelledby="help-title" aria-describedby="help-description">
        <DialogHeader>
          <DialogTitle id="help-title">Ajuda</DialogTitle>
          <DialogDescription id="help-description">
            {mutation.isSuccess
              ? 'O seu pedido foi enviado.'
              : 'Conte-nos o que se passa. Respondemos por email, normalmente no mesmo dia útil.'}
          </DialogDescription>
        </DialogHeader>

        {mutation.isSuccess ? (
          <div className="space-y-3">
            <p role="status" className="rounded-lg bg-accent p-4 text-sm text-foreground">
              Referência <strong>#{mutation.data.reference}</strong>. Respondemos por email
              {signedIn ? ` para ${session?.user?.email}` : ` para ${email.trim()}`}. Guarde a referência se quiser perguntar por ele.
            </p>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Fechar</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); submit() }}
            noValidate
          >
            <div>
              <Label htmlFor="help-category">Assunto</Label>
              <select
                id="help-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as SupportCategory)}
                className="mt-1 flex h-10 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {(Object.keys(SUPPORT_CATEGORY_LABELS) as SupportCategory[]).map((value) => (
                  <option key={value} value={value}>{SUPPORT_CATEGORY_LABELS[value]}</option>
                ))}
              </select>
            </div>

            {signedIn && upcoming.length > 0 && (
              <div>
                <Label htmlFor="help-booking">Reserva (opcional)</Label>
                <select
                  id="help-booking"
                  value={bookingId}
                  onChange={(e) => setBookingId(e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Não é sobre uma reserva</option>
                  {upcoming.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.room?.name ?? 'Sala'} — {format(parseISO(b.start_time), "d MMM, HH:mm", { locale: pt })}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <Label htmlFor="help-message">Mensagem</Label>
              <Textarea
                id="help-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                maxLength={MAX_MESSAGE}
                aria-invalid={!!errors.message}
                aria-describedby={errors.message ? 'help-message-error' : 'help-message-hint'}
                className="mt-1"
                placeholder="O que aconteceu, e o que esperavas que acontecesse?"
              />
              {errors.message ? (
                <p id="help-message-error" role="alert" className="mt-1 text-xs text-red-600">{errors.message}</p>
              ) : (
                <p id="help-message-hint" className="mt-1 text-xs text-muted-foreground">{message.trim().length}/{MAX_MESSAGE}</p>
              )}
            </div>

            <div>
              <Label htmlFor="help-email">Email</Label>
              <Input
                id="help-email"
                type="email"
                value={signedIn ? session?.user?.email ?? '' : email}
                onChange={(e) => setEmail(e.target.value)}
                readOnly={signedIn}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'help-email-error' : undefined}
                className={signedIn ? 'mt-1 bg-accent/50' : 'mt-1'}
                placeholder="o-seu@email.pt"
                autoComplete="email"
              />
              {errors.email && <p id="help-email-error" role="alert" className="mt-1 text-xs text-red-600">{errors.email}</p>}
            </div>

            {/* Honeypot: invisible to people and to screen readers, filled by bots. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label htmlFor="help-website">Website</label>
              <input id="help-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>

            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">O que enviamos com o pedido</summary>
              <p className="mt-1">
                Para percebermos o problema, o pedido leva o endereço da página onde está, o tamanho do ecrã,
                o browser que usa, a versão da app ({APP_VERSION}) e a hora do envio
                {signedIn ? ', e o identificador de utilizador da sua conta' : ''}. Nada mais: sem capturas de ecrã.
              </p>
            </details>

            {mutation.isError && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{submitErrorMessage(mutation.error)}</p>
            )}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancelar</Button>
              <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'A enviar…' : 'Enviar'}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
