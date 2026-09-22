'use client'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { HelpDialog } from '@/components/help/HelpDialog'
import type { SupportCategory } from '@/types'

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

  const openHelp = useCallback((next: HelpPreset = {}) => {
    setPreset(next)
    setKey((k) => k + 1)
    setOpen(true)
  }, [])
  const value = useMemo(() => ({ openHelp }), [openHelp])

  return (
    <HelpContext.Provider value={value}>
      {children}
      <HelpDialog key={key} open={open} onOpenChange={setOpen} initialCategory={preset.category} initialBookingId={preset.bookingId} />
    </HelpContext.Provider>
  )
}

export function useHelp(): HelpContextValue {
  const value = useContext(HelpContext)
  if (!value) throw new Error('useHelp must be used inside <HelpProvider>')
  return value
}
