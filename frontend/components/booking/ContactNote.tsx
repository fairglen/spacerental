'use client'
import { MessageCircle } from 'lucide-react'
import { CONTACT_EMAIL, contactMailto } from '@/lib/contact'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface ContactNoteProps {
  roomName: string
  /** 'note' is the calm box on the booking page; 'inline' is the one muted line in the confirm dialog. */
  variant?: 'note' | 'inline'
  className?: string
}

/**
 * Where anything that is not a plain hourly booking goes: a mailbox (C12).
 *
 * Deliberately not a form, an inbox or a dismissible banner — handling these
 * requests in the admin panel is TODO.md D06. It is information, not a
 * warning: `role="note"`, neutral colours, nothing to close and nothing
 * remembered, and it never stands between the customer and the calendar.
 */
export function ContactNote({ roomName, variant = 'note', className }: ContactNoteProps) {
  const t = useT()
  const link = (
    <a
      href={contactMailto(t('contactNote.subject', { room: roomName }))}
      className="font-medium text-primary underline underline-offset-2 hover:text-foreground"
    >
      {CONTACT_EMAIL}
    </a>
  )

  if (variant === 'inline') {
    return (
      <p role="note" className={cn('text-xs text-muted-foreground', className)}>
        {t('contactNote.lead')} {t('contactNote.body')} {t('contactNote.cta')} {link}
      </p>
    )
  }

  return (
    <p
      role="note"
      className={cn('flex items-start gap-2 rounded-lg border border-border bg-accent/50 px-3 py-2 text-sm text-foreground', className)}
    >
      <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
      <span>
        <span className="font-medium">{t('contactNote.lead')}</span> {t('contactNote.body')} {t('contactNote.cta')} {link}
      </span>
    </p>
  )
}
