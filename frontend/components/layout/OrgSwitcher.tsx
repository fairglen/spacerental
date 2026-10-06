'use client'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useOrg } from '@/contexts/OrgContext'
import { useT } from '@/lib/i18n'

/**
 * The organisation selector in the navbar. Its own module, loaded by the
 * navbar on demand (P1.3): the select primitive and its positioning engine
 * are 16 KB gzipped that every public page used to ship for a control only a
 * signed-in member of several organisations ever sees.
 */
export function OrgSwitcher({ className }: { className?: string }) {
  const t = useT()
  const { memberships, currentOrgId, setCurrentOrgId } = useOrg()
  // A customer with one membership has nothing to switch between (B33b).
  if (memberships.length < 2) return null

  return (
    <div className={className}>
      <Select value={currentOrgId ?? undefined} onValueChange={setCurrentOrgId}>
        <SelectTrigger aria-label={t('navbar.org_selector_label')} className="h-9 min-w-48">
          <SelectValue placeholder={t('navbar.org_selector_placeholder')} />
        </SelectTrigger>
        <SelectContent>
          {memberships.map((m) => (
            <SelectItem key={m.org_id} value={m.org_id}>
              {m.org_name || 'Organização'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
