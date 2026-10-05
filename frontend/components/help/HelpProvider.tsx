'use client'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import type { SupportCategory } from '@/types'

// The dialog, its form and what they pull in (date-fns and its locales among
// them) load the first time someone asks for help (P1.3) — every page used
// to ship them for a dialog that starts closed.
const HelpDialog = dynamic(() => import('@/components/help/HelpDialog').then((m) => m.HelpDialog), { ssr: false })

export type HelpPreset = { category?: SupportCategory; bookingId?: string }

type HelpContextValue = { openHelp: (preset?: HelpPreset) => void }

const HelpContext = createContext<HelpContextValue | null>(null)

/**
 * One help dialog for the whole app (C17). The navbar, the footer, the
 * booking contact note and the cancel dialog all open the same one, each with
 * its own preset, so there is exactly one place that owns its state.
 */
export function HelpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [preset, setPreset] = useState<HelpPreset>({})
  // A new key per opening: the dialog starts from its presets every time
  // instead of remembering a half-written message from the last one.
  const [key, setKey] = useState(0)
  // Mounted from the first opening on, so closing keeps the loaded module
  // and the next opening is immediate.
  const [requested, setRequested] = useState(false)

  const openHelp = useCallback((next: HelpPreset = {}) => {
    setPreset(next)
    setKey((k) => k + 1)
    setRequested(true)
    setOpen(true)
  }, [])
  const value = useMemo(() => ({ openHelp }), [openHelp])

  return (
    <HelpContext.Provider value={value}>
      {children}
      {requested && (
        <HelpDialog key={key} open={open} onOpenChange={setOpen} initialCategory={preset.category} initialBookingId={preset.bookingId} />
      )}
    </HelpContext.Provider>
  )
}

export function useHelp(): HelpContextValue {
  const value = useContext(HelpContext)
  if (!value) throw new Error('useHelp must be used inside <HelpProvider>')
  return value
}
