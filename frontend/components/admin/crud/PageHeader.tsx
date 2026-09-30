import Link from 'next/link'
import type { ReactNode } from 'react'

export type Crumb = { label: string; href?: string }

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Navegação" className="text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden>/</span>}
            {item.href ? <Link href={item.href} className="hover:text-foreground hover:underline">{item.label}</Link> : <span aria-current="page" className="text-foreground">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function PageHeader({ title, description, crumbs, actions, badge }: { title: string; description?: string; crumbs?: Crumb[]; actions?: ReactNode; badge?: ReactNode }) {
  return (
    <div className="mb-6 space-y-2">
      {crumbs && <Breadcrumbs items={crumbs} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">{title}{badge}</h1>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}
