import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Pricing } from '@/components/landing/Pricing'

describe('Pricing', () => {
  it('renders three pricing plans', () => {
    render(<Pricing />)
    expect(screen.getByText('Hora a Hora')).toBeInTheDocument()
    expect(screen.getByText('Pack 10 Horas')).toBeInTheDocument()
    expect(screen.getByText('Pack 20 Horas')).toBeInTheDocument()
  })
  it('shows the popular badge on the middle plan', () => {
    render(<Pricing />)
    expect(screen.getByText('Mais Popular')).toBeInTheDocument()
  })
  it('shows the €11 hourly rate', () => {
    render(<Pricing />)
    expect(screen.getByText('€11')).toBeInTheDocument()
  })
})
