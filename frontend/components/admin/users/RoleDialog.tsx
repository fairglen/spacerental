'use client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { OrgUser } from '@/types'

export const ROLE_LABELS: Record<OrgUser['role'], string> = { owner: 'Proprietário', admin: 'Administrador', member: 'Cliente' }

interface RoleDialogProps {
  user: OrgUser | null
  busy: boolean
  error: string | null
  onConfirm: (role: 'admin' | 'member') => void
  onClose: () => void
}

/**
 * "Tornar admin" / "Remover admin" with a confirm step (A05). The role is per
 * organisation; the page never offers this for the operator's own account or
 * for an owner, so the dialog only has to say what is about to change.
 */
export function RoleDialog({ user, busy, error, onConfirm, onClose }: RoleDialogProps) {
  const next: 'admin' | 'member' = user?.role === 'admin' ? 'member' : 'admin'
  return (
    <Dialog open={!!user} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {user && (
          <>
            <DialogHeader>
              <DialogTitle>{next === 'admin' ? 'Tornar administrador' : 'Remover administrador'}</DialogTitle>
              <DialogDescription>
                {next === 'admin'
                  ? `${user.name || user.email} passa a poder gerir reservas, salas, packs e clientes deste espaço.`
                  : `${user.name || user.email} deixa de ter acesso ao painel de administração deste espaço. As reservas e packs continuam.`}
              </DialogDescription>
            </DialogHeader>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
              <Button variant={next === 'admin' ? 'default' : 'destructive'} onClick={() => onConfirm(next)} disabled={busy}>
                {busy ? 'A guardar…' : next === 'admin' ? 'Confirmar: tornar admin' : 'Confirmar: remover admin'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
