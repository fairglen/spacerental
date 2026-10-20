'use client'
import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { format, isPast, parseISO } from 'date-fns'
import { ExternalLink } from 'lucide-react'
import { bookingsApi, createAuthenticatedApi, supportApi } from '@/lib/api'
import { dateFnsLocale } from '@/lib/dates'
import { statusOf } from '@/lib/httpError'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { t, tFor, useLocale, useT } from '@/lib/i18n'
import type { SupportCategory, SupportRequestBody } from '@/types'

/** B70: the static site's FAQ answers most of what reaches this form. */
export const FAQ_URL = 'https://flowspace.pt/#faq'

interface HelpDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Presets from whoever opened it; not URL state, so a reload forgets them. */
  initialCategory?: SupportCategory
  initialBookingId?: string
}

/** A category's label in the browser's locale unless the caller binds one (B65). */
export function supportCategoryLabel(category: SupportCategory, translate: typeof t = t): string {
  return translate(`help.category_${category}`)
}

// B65: the admin's support screens are Portuguese only (D02) and read the
// labels as values; the dialog goes through `supportCategoryLabel`.
const ptLabel = (category: SupportCategory) => supportCategoryLabel(category, tFor('pt'))
export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  technical: ptLabel('technical'),
  booking: ptLabel('booking'),
  payment: ptLabel('payment'),
  package: ptLabel('package'),
  other: ptLabel('other'),
}

const MIN_MESSAGE = 20
const MAX_MESSAGE = 2000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Baked in at build time by next.config.js; "dev" when nothing is set.
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'dev'

function submitErrorMessage(error: unknown, translate: typeof t): string {
  switch (statusOf(error)) {
    case 401: return translate('help.error_401')
    case 404: return translate('help.error_404')
    case 422: return translate('help.error_422', { min: MIN_MESSAGE, max: MAX_MESSAGE })
    case 429: return translate('errors.too_many_requests')
    case undefined: return translate('errors.offline')
    default: return translate('help.error_default')
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
  const t = useT()
  const [locale] = useLocale()
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
    if (trimmed.length < MIN_MESSAGE) next.message = t('help.message_too_short', { min: MIN_MESSAGE })
    else if (trimmed.length > MAX_MESSAGE) next.message = t('help.message_too_long', { max: MAX_MESSAGE })
    if (!signedIn && !EMAIL_PATTERN.test(email.trim())) next.email = t('help.email_invalid')
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
          <DialogTitle id="help-title">{t('help.title')}</DialogTitle>
          <DialogDescription id="help-description">
            {mutation.isSuccess ? t('help.sent') : t('help.description')}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          <a
            href={FAQ_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('help.faq_link')}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </p>

        {mutation.isSuccess ? (
          <div className="space-y-3">
            <p role="status" className="rounded-lg bg-accent p-4 text-sm text-foreground">
              {t('help.success_reference_label')} <strong>#{mutation.data.reference}</strong>. {t('help.success_copy', { email: signedIn ? session?.user?.email ?? '' : email.trim() })}
            </p>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{t('help.close')}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); submit() }}
            noValidate
          >
            <div>
              <Label htmlFor="help-category">{t('help.category_label')}</Label>
              <select
                id="help-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as SupportCategory)}
                className="mt-1 flex h-10 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
              >
                {(Object.keys(SUPPORT_CATEGORY_LABELS) as SupportCategory[]).map((value) => (
                  <option key={value} value={value}>{supportCategoryLabel(value, t)}</option>
                ))}
              </select>
            </div>

            {signedIn && upcoming.length > 0 && (
              <div>
                <Label htmlFor="help-booking">{t('help.booking_label')}</Label>
                <select
                  id="help-booking"
                  value={bookingId}
                  onChange={(e) => setBookingId(e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
                >
                  <option value="">{t('help.booking_none')}</option>
                  {upcoming.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.room?.name ?? t('help.room_fallback')} — {format(parseISO(b.start_time), "d MMM, HH:mm", { locale: dateFnsLocale(locale) })}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <Label htmlFor="help-message">{t('help.message_label')}</Label>
              <Textarea
                id="help-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                maxLength={MAX_MESSAGE}
                aria-invalid={!!errors.message}
                aria-describedby={errors.message ? 'help-message-error' : 'help-message-hint'}
                className="mt-1"
                placeholder={t('help.message_placeholder')}
              />
              {errors.message ? (
                <p id="help-message-error" role="alert" className="mt-1 text-xs text-red-600">{errors.message}</p>
              ) : (
                <p id="help-message-hint" className="mt-1 text-xs text-muted-foreground">{message.trim().length}/{MAX_MESSAGE}</p>
              )}
            </div>

            <div>
              <Label htmlFor="help-email">{t('help.email_label')}</Label>
              <Input
                id="help-email"
                type="email"
                value={signedIn ? session?.user?.email ?? '' : email}
                onChange={(e) => setEmail(e.target.value)}
                readOnly={signedIn}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'help-email-error' : undefined}
                className={signedIn ? 'mt-1 bg-accent/50' : 'mt-1'}
                placeholder={t('help.email_placeholder')}
                autoComplete="email"
              />
              {errors.email && <p id="help-email-error" role="alert" className="mt-1 text-xs text-red-600">{errors.email}</p>}
            </div>

            {/* Honeypot: invisible to people and to screen readers, filled by bots. */}
            <div aria-hidden="true" className="absolute left-[-9999px] h-px w-px overflow-hidden">
              <label htmlFor="help-website">Website</label>
              <input id="help-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>

            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">{t('help.context_summary')}</summary>
              <p className="mt-1">
                {t('help.context_body', { version: APP_VERSION, user: signedIn ? t('help.context_user') : '' })}
              </p>
            </details>

            {mutation.isError && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{submitErrorMessage(mutation.error, t)}</p>
            )}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>{t('help.cancel')}</Button>
              <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? t('help.submitting') : t('help.submit')}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
