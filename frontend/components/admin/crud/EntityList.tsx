'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The shared list (G05): toolbar (search with a 300 ms debounce, filter
 * chips, sort), a sticky-header table with 44 px rows, row click → detail,
 * a per-row ⋯ menu, empty/loading/error states, the existing pagination
 * shape, and ↑ ↓ Enter over the rows. State comes from `useListState`, so
 * it lives in the URL.
 */
export type Column<T> = {
  key: string
  header: string
  render: (row: T) => ReactNode
  className?: string
  /** Column header carries this sort key; `-` prefixed when descending. */
  sortKey?: string
}

export type FilterChip = { key: string; label: string; options: Array<{ value: string; label: string }> }
export type SortOption = { value: string; label: string }
export type RowAction<T> = { label: string; onSelect: (row: T) => void; destructive?: boolean; hidden?: (row: T) => boolean }

export type EntityListProps<T> = {
  caption: string
  columns: Column<T>[]
  rows: T[] | undefined
  rowKey: (row: T) => string
  rowHref?: (row: T) => string
  rowActions?: RowAction<T>[]
  total?: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  search?: { value: string; onChange: (q: string) => void; placeholder?: string }
  filters?: { chips: FilterChip[]; values: Record<string, string>; onChange: (key: string, value: string | undefined) => void }
  sort?: { options: SortOption[]; value: string; onChange: (sort: string) => void }
  isLoading?: boolean
  isError?: boolean
  onRetry?: () => void
  empty: { title: string; description?: string; action?: ReactNode }
  toolbarExtra?: ReactNode
}

/**
 * `flush` settles a pending debounce now. Opening a row right after typing
 * must call it first: the list syncs the search into the URL with
 * `router.replace`, and a replace that fires after the row's `router.push`
 * pulls the browser back to the list.
 */
export function useDebounced(value: string, onChange: (v: string) => void, ms = 300) {
  const [draft, setDraft] = useState(value)
  const first = useRef(true)
  // The latest `onChange`, so a flush never replays a stale filter state.
  const latest = useRef(onChange)
  latest.current = onChange
  const pending = useRef<{ id: ReturnType<typeof setTimeout>; draft: string } | null>(null)
  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (draft === value) return
    const id = setTimeout(() => { pending.current = null; latest.current(draft) }, ms)
    pending.current = { id, draft }
    return () => { clearTimeout(id); if (pending.current?.id === id) pending.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])
  const flush = useCallback(() => {
    if (!pending.current) return
    const { id, draft: value } = pending.current
    clearTimeout(id)
    pending.current = null
    latest.current(value)
  }, [])
  return [draft, setDraft, flush] as const
}

export function EntityList<T>({
  caption, columns, rows, rowKey, rowHref, rowActions = [], total, page, pageSize, onPageChange,
  search, filters, sort, isLoading, isError, onRetry, empty, toolbarExtra,
}: EntityListProps<T>) {
  const router = useRouter()
  const [draft, setDraft, flushSearch] = useDebounced(search?.value ?? '', (q) => search?.onChange(q))
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [focusIndex, setFocusIndex] = useState<number>(-1)
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  const pages = Math.max(1, Math.ceil((total ?? rows?.length ?? 0) / pageSize))
  const visibleActions = useMemo(() => rowActions, [rowActions])

  useEffect(() => {
    if (focusIndex < 0) return
    const row = bodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-row]')[focusIndex]
    row?.focus()
  }, [focusIndex])

  function open(row: T) {
    if (!rowHref) return
    // The pending search lands in the URL before the push, in this order,
    // so the back button returns to the filtered list — not after it.
    flushSearch()
    router.push(rowHref(row))
  }

  function onRowKey(e: KeyboardEvent<HTMLTableRowElement>, index: number, row: T) {
    if (!rows) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIndex(Math.min(rows.length - 1, index + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIndex(Math.max(0, index - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); open(row) }
  }

  return (
    <div className="space-y-3">
      {(search || filters || sort || toolbarExtra) && (
        <div className="flex flex-wrap items-center gap-2" role="search">
          {search && (
            <label className="relative flex-1 min-w-48">
              <span className="sr-only">Pesquisar</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={search.placeholder ?? 'Pesquisar…'}
                className="pl-9"
                aria-label="Pesquisar"
              />
            </label>
          )}
          {filters?.chips.map((chip) => (
            <label key={chip.key} className="text-sm">
              <span className="sr-only">{chip.label}</span>
              <select
                aria-label={chip.label}
                value={filters.values[chip.key] ?? ''}
                onChange={(e) => filters.onChange(chip.key, e.target.value || undefined)}
                className={cn(
                  'h-10 rounded-full border px-3 text-sm bg-white',
                  filters.values[chip.key] ? 'border-primary text-primary' : 'border-border text-foreground',
                )}
              >
                <option value="">{chip.label}</option>
                {chip.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          ))}
          {sort && (
            <label className="text-sm ml-auto">
              <span className="sr-only">Ordenar</span>
              <select aria-label="Ordenar" value={sort.value} onChange={(e) => sort.onChange(e.target.value)} className="h-10 rounded-lg border border-border px-3 text-sm bg-white">
                {sort.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
          {toolbarExtra}
        </div>
      )}

      <div className="rounded-xl border border-border bg-white overflow-hidden">
        <div className="overflow-x-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead className="sticky top-0 z-10 bg-[#F8FAF9] text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} scope="col" className={cn('px-4 py-3 font-medium', c.className)}>
                    {c.sortKey && sort ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => sort.onChange(sort.value === c.sortKey ? `-${c.sortKey}` : c.sortKey!)}
                        aria-label={`Ordenar por ${c.header}`}
                      >
                        {c.header}
                        {sort.value.replace(/^-/, '') === c.sortKey && <span aria-hidden>{sort.value.startsWith('-') ? '↓' : '↑'}</span>}
                      </button>
                    ) : c.header}
                  </th>
                ))}
                {visibleActions.length > 0 && <th scope="col" className="px-2 py-3 w-12"><span className="sr-only">Ações</span></th>}
              </tr>
            </thead>
            <tbody ref={bodyRef}>
              {isLoading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={`s${i}`} className="border-t border-border" aria-hidden>
                  {columns.map((c) => <td key={c.key} className="px-4 py-3 h-11"><Skeleton className="h-4 w-3/4" /></td>)}
                  {visibleActions.length > 0 && <td />}
                </tr>
              ))}
              {!isLoading && isError && (
                <tr className="border-t border-border">
                  <td colSpan={columns.length + 1} className="px-4 py-8 text-center">
                    <p role="alert" className="text-sm text-red-600">Não foi possível carregar a lista.</p>
                    {onRetry && <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>Tentar novamente</Button>}
                  </td>
                </tr>
              )}
              {!isLoading && !isError && rows && rows.length === 0 && (
                <tr className="border-t border-border">
                  <td colSpan={columns.length + 1} className="px-4 py-12 text-center">
                    <p className="font-medium text-foreground">{empty.title}</p>
                    {empty.description && <p className="text-sm text-muted-foreground mt-1">{empty.description}</p>}
                    {empty.action && <div className="mt-4 flex justify-center">{empty.action}</div>}
                  </td>
                </tr>
              )}
              {!isLoading && !isError && rows?.map((row, index) => {
                const key = rowKey(row)
                const actions = visibleActions.filter((a) => !a.hidden?.(row))
                return (
                  <tr
                    key={key}
                    data-row
                    tabIndex={0}
                    aria-label={rowHref ? `Abrir ${key.slice(0, 8)}` : undefined}
                    onKeyDown={(e) => onRowKey(e, index, row)}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('button, a, input, select')) return
                      open(row)
                    }}
                    className={cn(
                      'border-t border-border h-11 focus:outline-hidden focus-visible:bg-accent',
                      rowHref && 'cursor-pointer hover:bg-[#F8FAF9]',
                    )}
                  >
                    {columns.map((c) => <td key={c.key} className={cn('px-4 py-2 align-middle', c.className)}>{c.render(row)}</td>)}
                    {visibleActions.length > 0 && (
                      <td className="px-2 py-2 relative text-right">
                        {actions.length > 0 && (
                          <>
                            <Button
                              type="button" variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={menuFor === key}
                              aria-label={`Ações para ${key.slice(0, 8)}`}
                              onClick={() => setMenuFor(menuFor === key ? null : key)}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                            {menuFor === key && (
                              <div role="menu" className="absolute right-2 z-20 mt-1 min-w-40 rounded-lg border border-border bg-white py-1 shadow-lg text-left">
                                {actions.map((a) => (
                                  <button
                                    key={a.label} role="menuitem" type="button"
                                    className={cn('block w-full px-3 py-2 text-left text-sm hover:bg-[#F8FAF9]', a.destructive && 'text-red-600')}
                                    onClick={() => { setMenuFor(null); a.onSelect(row) }}
                                  >
                                    {a.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {(total !== undefined && total > pageSize) && (
          <nav className="flex items-center justify-between border-t border-border px-4 py-2 text-sm" aria-label="Paginação">
            <span className="text-muted-foreground">{total} no total · página {page} de {pages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>Seguinte</Button>
            </div>
          </nav>
        )}
      </div>
    </div>
  )
}
