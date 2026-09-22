import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoleDialog } from '@/components/admin/users/RoleDialog'
import { GrantHoursDialog } from '@/components/admin/users/GrantHoursDialog'
import type { OrgUser, Package } from '@/types'

const ana: OrgUser = { id: 'u1', email: 'ana@example.com', name: 'Ana', role: 'member', joined_at: '2026-01-01T00:00:00Z', bookings_count: 2, created_at: '2026-01-01T00:00:00Z' }
const packages: Package[] = [
  { id: 'k10', org_id: 'o', name: 'Pack 10h', hours: 10, price: 100, validity_days: 90, is_active: true },
  { id: 'k20', org_id: 'o', name: 'Pack 20h', hours: 20, price: 180, validity_days: 180, is_active: true },
]

// A05: the confirm step before a role changes, and what "Atribuir horas" sends.
describe('RoleDialog', () => {
  it('a member: confirms before making them admin, and says what that means', async () => {
    const onConfirm = vi.fn()
    render(<RoleDialog user={ana} busy={false} error={null} onConfirm={onConfirm} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Tornar administrador' })).toBeInTheDocument()
    expect(screen.getByText(/Ana passa a poder gerir/)).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar: tornar admin' }))
    expect(onConfirm).toHaveBeenCalledWith('admin')
  })

  it('an admin: the confirm demotes to member and the button is destructive', async () => {
    const onConfirm = vi.fn()
    render(<RoleDialog user={{ ...ana, role: 'admin' }} busy={false} error={null} onConfirm={onConfirm} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Remover administrador' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar: remover admin' }))
    expect(onConfirm).toHaveBeenCalledWith('member')
  })

  it('cancel closes without confirming; a server error is shown', async () => {
    const onConfirm = vi.fn(); const onClose = vi.fn()
    render(<RoleDialog user={ana} busy={false} error="You cannot change your own role" onConfirm={onConfirm} onClose={onClose} />)
    expect(screen.getByRole('alert')).toHaveTextContent('You cannot change your own role')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('GrantHoursDialog', () => {
  function renderIt(onSubmit = vi.fn()) {
    render(<GrantHoursDialog open userLabel="Ana" packages={packages} busy={false} error={null} onSubmit={onSubmit} onClose={vi.fn()} />)
    return onSubmit
  }

  it('sends hours, the chosen pack and the reason, without an expiry when none is given', async () => {
    const onSubmit = renderIt()
    await userEvent.clear(screen.getByLabelText('Horas'))
    await userEvent.type(screen.getByLabelText('Horas'), '3')
    await userEvent.selectOptions(screen.getByLabelText('Pack de base'), 'k20')
    await userEvent.type(screen.getByLabelText('Motivo'), 'compensação pela avaria')
    expect(screen.getByText(/valem 180 dias a partir de hoje/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Atribuir horas' }))
    expect(onSubmit).toHaveBeenCalledWith({ hours: 3, package_id: 'k20', reason: 'compensação pela avaria' })
  })

  it('refuses without a reason and with zero hours, and never submits', async () => {
    const onSubmit = renderIt()
    await userEvent.click(screen.getByRole('button', { name: 'Atribuir horas' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Escreve o motivo')
    await userEvent.type(screen.getByLabelText('Motivo'), 'ok então')
    await userEvent.clear(screen.getByLabelText('Horas'))
    await userEvent.type(screen.getByLabelText('Horas'), '0')
    await userEvent.click(screen.getByRole('button', { name: 'Atribuir horas' }))
    expect(screen.getByRole('alert')).toHaveTextContent('entre 0,5 e 999')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('an explicit date is sent as the end of that day, in ISO', async () => {
    const onSubmit = renderIt()
    await userEvent.type(screen.getByLabelText('Motivo'), 'oferta de boas-vindas')
    await userEvent.type(screen.getByLabelText('Válidas até (opcional)'), '2030-06-30')
    await userEvent.click(screen.getByRole('button', { name: 'Atribuir horas' }))
    const body = onSubmit.mock.calls[0][0]
    expect(body.expires_at).toBe(new Date('2030-06-30T23:59:59').toISOString())
    expect(body.hours).toBe(1)
  })
})
