'use client'
import { type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'

/**
 * B69: the mobile sheet below the bar — its own scroll, the page's locked,
 * focus trapped, Escape closes; the Dialog primitive gives all of that. The
 * Navbar loads this module on the first tap (next/dynamic), so the primitive
 * is not in any page's first JS (the landing's budget, P2.4).
 */
export function MobileMenu({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-x-0 top-16 bottom-0 z-40 bg-black/20 md:hidden" />
        <DialogPrimitive.Content
          data-testid="mobile-menu"
          className="fixed inset-x-0 top-16 bottom-0 z-50 overflow-y-auto overscroll-contain border-t border-border bg-white px-4 pb-8 pt-2 md:hidden focus:outline-none"
          onOpenAutoFocus={(event) => {
            // The first entry, not the close button: one less tap.
            event.preventDefault()
            ;(event.currentTarget as HTMLElement).querySelector<HTMLElement>('a, button')?.focus()
          }}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
