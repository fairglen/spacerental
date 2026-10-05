import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PaymentNotice, paymentOutcomeOf } from '@/components/booking/PaymentNotice'

// B25 on the dashboard, K02 on the booking page: one component, two contexts.
describe('PaymentNotice', () => {
  it('reads only the two outcomes Checkout returns with', () => {
    expect(paymentOutcomeOf('sucesso')).toBe('sucesso')
    expect(paymentOutcomeOf('cancelado')).toBe('cancelado')
    expect(paymentOutcomeOf('ok')).toBeNull()
    expect(paymentOutcomeOf(null)).toBeNull()
  })

  it('on the dashboard points at the packs page; on the booking page points at the booking below', () => {
    const { rerender } = render(<PaymentNotice outcome="sucesso" onClose={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('Os meus packs')
    rerender(<PaymentNotice outcome="sucesso" onClose={vi.fn()} context="booking" />)
    expect(screen.getByRole('status')).toHaveTextContent(/Confirme a reserva abaixo com as horas do pack/)
    expect(screen.getByRole('status')).not.toHaveTextContent('Os meus packs')
    rerender(<PaymentNotice outcome="cancelado" onClose={vi.fn()} context="booking" />)
    expect(screen.getByRole('status')).toHaveTextContent(/Não foi cobrado nada/)
    expect(screen.getByRole('status')).toHaveTextContent(/outra forma/)
  })

  it('closes', () => {
    const onClose = vi.fn()
    render(<PaymentNotice outcome="cancelado" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }))
    expect(onClose).toHaveBeenCalled()
  })
})
