import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { PaymentNotice, paymentOutcomeOf } from '@/components/booking/PaymentNotice'
import { resetLocaleForTests, setLocale } from '@/lib/i18n'

afterEach(() => resetLocaleForTests())

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

  // B70: a pack just paid for on the dashboard — say how the hours get used.
  it('after a successful payment on the dashboard says how to use the hours, with the way to the rooms', () => {
    const { rerender } = render(<PaymentNotice outcome="sucesso" onClose={vi.fn()} />)
    const prompt = within(screen.getByRole('status')).getByTestId('use-hours-prompt')
    expect(prompt).toHaveTextContent(/Para usar as horas, reserve uma sala/)
    expect(within(prompt).getByRole('link', { name: /Reservar uma sala/ })).toHaveAttribute('href', '/spaces')
    // Not after a failed payment, nor on the booking page (the room is below).
    rerender(<PaymentNotice outcome="cancelado" onClose={vi.fn()} />)
    expect(screen.queryByTestId('use-hours-prompt')).toBeNull()
    rerender(<PaymentNotice outcome="sucesso" onClose={vi.fn()} context="booking" />)
    expect(screen.queryByTestId('use-hours-prompt')).toBeNull()
  })

  it('says it in English when the locale is EN', () => {
    setLocale('en')
    render(<PaymentNotice outcome="sucesso" onClose={vi.fn()} />)
    expect(screen.getByRole('link', { name: /Book a room/ })).toHaveAttribute('href', '/spaces')
    expect(screen.getByTestId('use-hours-prompt')).toHaveTextContent(/To use the hours, book a room/)
  })

  it('closes', () => {
    const onClose = vi.fn()
    render(<PaymentNotice outcome="cancelado" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }))
    expect(onClose).toHaveBeenCalled()
  })
})
