'use client'
import { createContext, useContext, type ReactNode } from 'react'
import { DEFAULT_LOCALE, type Locale } from './locale'

// B64: the locale the server read from the cookie, handed to every client
// component as the snapshot it renders with on the server and hydrates
// against. Module state cannot carry it: on the server one process serves
// every request, and the client's store is read from its own cookie.
const InitialLocaleContext = createContext<Locale>(DEFAULT_LOCALE)

export function LocaleProvider({ initial, children }: { initial: Locale; children: ReactNode }) {
  return <InitialLocaleContext.Provider value={initial}>{children}</InitialLocaleContext.Provider>
}

export function useInitialLocale(): Locale {
  return useContext(InitialLocaleContext)
}
