'use client'
import { createContext, useContext, type ReactNode } from 'react'
import { DEFAULT_LOCALE, type Locale } from './locale'
import { hasCatalog, registerCatalog, type Catalog } from './registry'

// B64: the locale the server read from the cookie, handed to every client
// component as the snapshot it renders with on the server and hydrates
// against. Module state cannot carry it: on the server one process serves
// every request, and the client's store is read from its own cookie.
const InitialLocaleContext = createContext<Locale>(DEFAULT_LOCALE)

export function LocaleProvider({
  initial,
  initialCatalog,
  children,
}: {
  initial: Locale
  /** The locale's catalog when it is not the bundled Portuguese (B65). */
  initialCatalog?: Catalog | null
  children: ReactNode
}) {
  // Before any child renders — on the server and in the hydration pass alike
  // — so every `t()` below already finds the language the HTML is in.
  if (initialCatalog && !hasCatalog(initial)) registerCatalog(initial, initialCatalog)
  return <InitialLocaleContext.Provider value={initial}>{children}</InitialLocaleContext.Provider>
}

export function useInitialLocale(): Locale {
  return useContext(InitialLocaleContext)
}
