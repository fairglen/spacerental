import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Footer } from '@/components/layout/Footer'

describe('Footer component i18n refactor (9.1)', () => {
  it('renders all footer text content in Portuguese', () => {
    render(<Footer />)

    // Tagline
    expect(
      screen.getByText(
        /Espaços profissionais por hora para psicólogos, terapeutas e outros profissionais de saúde/
      )
    ).toBeInTheDocument()

    // Section headings
    expect(screen.getByText('Links')).toBeInTheDocument()
    expect(screen.getByText('Contacto')).toBeInTheDocument()

    // Links
    expect(screen.getByRole('link', { name: 'Espaços' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Como Funciona' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Preços' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Entrar' })).toBeInTheDocument()

    // Contact info
    expect(screen.getByText('Lisboa, Portugal')).toBeInTheDocument()
    expect(screen.getByText('geral@espacohora.pt')).toBeInTheDocument()

    // Copyright
    const currentYear = new Date().getFullYear()
    expect(screen.getByText(new RegExp(`© ${currentYear} EspaçoHora.*Todos os direitos reservados`))).toBeInTheDocument()
  })
})
