'use client'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { LogOut, User, type LucideIcon } from 'lucide-react'

export interface AccountMenuLink {
  href: string
  label: string
  icon: LucideIcon
}

const ITEM = 'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground outline-none hover:bg-accent focus:bg-accent'

/**
 * B69: the signed-in links behind the avatar on desktop. Hand-rolled on
 * purpose — the Radix menu stack is ~30 KB of JS on every page (the landing's
 * budget, P2.4) for a menu with four entries. Outside click and Escape close
 * it, arrows move between the entries, Tab leaves and closes.
 */
export function AccountMenu({
  label,
  name,
  email,
  links,
  signOutLabel,
  onSignOut,
}: {
  label: string
  name?: string | null
  email?: string | null
  links: AccountMenuLink[]
  signOutLabel: string
  onSignOut: () => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const items = () => Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])

  // On the wrapper, so Escape works whether focus is on the trigger (a mouse
  // click leaves it there) or on an entry.
  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return
    const list = items()
    const index = list.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      root.current?.querySelector<HTMLElement>('button')?.focus()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      list[(index + 1) % list.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      list[(index - 1 + list.length) % list.length]?.focus()
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (open) return
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen(true)
      // The first entry, once the menu is in the DOM.
      requestAnimationFrame(() => items()[0]?.focus())
    }
  }

  return (
    <div ref={root} className="relative" onKeyDown={onRootKeyDown}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-primary hover:ring-2 hover:ring-primary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <User className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-50 mt-2 min-w-60 rounded-lg border border-border bg-white p-1 shadow-lg"
        >
          <div className="px-2 py-2">
            {name && <p className="text-sm font-medium text-foreground">{name}</p>}
            {email && <p className="text-xs text-muted-foreground break-all">{email}</p>}
          </div>
          <div className="my-1 h-px bg-border" role="separator" />
          {links.map((l) => (
            <Link key={l.href} href={l.href} role="menuitem" tabIndex={-1} className={ITEM} onClick={() => setOpen(false)}>
              <l.icon className="h-4 w-4 text-muted-foreground" aria-hidden />
              {l.label}
            </Link>
          ))}
          <div className="my-1 h-px bg-border" role="separator" />
          <button type="button" role="menuitem" tabIndex={-1} className={ITEM} onClick={() => { setOpen(false); onSignOut() }}>
            <LogOut className="h-4 w-4 text-muted-foreground" aria-hidden />
            {signOutLabel}
          </button>
        </div>
      )}
    </div>
  )
}
