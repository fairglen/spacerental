import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Hero } from '@/components/landing/Hero'

describe('Hero component i18n refactor (9.1)', () => {
  it('renders all hero text content in Portuguese', () => {
    render(<Hero />)

    // Badge
    expect(screen.getByText('Disponível à hora, por pacote ou recorrente')).toBeInTheDocument()

    // Headline
    expect(screen.getByText(/O teu espaço/)).toBeInTheDocument()
    expect(screen.getByText(/no teu tempo/)).toBeInTheDocument()

    // Description
    expect(
      screen.getByText(/Salas privadas para psicólogos, terapeutas e profissionais de saúde/)
    ).toBeInTheDocument()

    // CTAs
    expect(screen.getByRole('link', { name: /Ver Espaços/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Saber Mais/ })).toBeInTheDocument()

    // Benefits
    expect(screen.getByText('Sem caução')).toBeInTheDocument()
    expect(screen.getByText(/Cancelamento gratuito 24h/)).toBeInTheDocument()
    expect(screen.getByText('Pagamento seguro')).toBeInTheDocument()
  })
})
