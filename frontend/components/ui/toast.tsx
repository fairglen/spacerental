'use client'
import * as React from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A small toast queue over Radix (G05). `useToast()` gives `toast({ title,
 * description?, variant? })`; `<Toaster />` mounts once in the admin shell.
 * Success toasts vanish on their own; an error stays until dismissed.
 */
export type ToastVariant = 'success' | 'error' | 'info'
export type ToastInput = { title: string; description?: string; variant?: ToastVariant }
type ToastItem = ToastInput & { id: number }

const ToastContext = React.createContext<{ toast: (t: ToastInput) => void } | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([])
  const next = React.useRef(1)
  const toast = React.useCallback((t: ToastInput) => {
    setItems((all) => [...all.slice(-4), { ...t, id: next.current++ }])
  }, [])
  const remove = (id: number) => setItems((all) => all.filter((t) => t.id !== id))
  return (
    <ToastContext.Provider value={{ toast }}>
      <ToastPrimitive.Provider swipeDirection="right" duration={4000}>
        {children}
        {items.map((t) => (
          <ToastPrimitive.Root
            key={t.id}
            duration={t.variant === 'error' ? Infinity : 4000}
            onOpenChange={(open) => !open && remove(t.id)}
            className={cn(
              'pointer-events-auto flex w-full items-start gap-3 rounded-lg border p-4 shadow-lg bg-white',
              t.variant === 'error' ? 'border-red-200' : t.variant === 'info' ? 'border-border' : 'border-primary/30',
            )}
          >
            <div className="flex-1 min-w-0">
              <ToastPrimitive.Title className={cn('text-sm font-semibold', t.variant === 'error' ? 'text-red-700' : 'text-foreground')}>{t.title}</ToastPrimitive.Title>
              {t.description && <ToastPrimitive.Description className="text-sm text-muted-foreground mt-0.5">{t.description}</ToastPrimitive.Description>}
            </div>
            <ToastPrimitive.Close aria-label="Fechar" className="rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary">
              <X className="h-4 w-4" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = React.useContext(ToastContext)
  // Outside a provider (a unit test rendering one piece) a toast is a no-op
  // rather than a crash: the page's behaviour never depends on it.
  return ctx ?? { toast: () => undefined }
}
