import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Hero } from '@/components/landing/Hero'

describe('Hero', () => {
  it('renders the headline', () => {
    render(<Hero />)
    expect(screen.getByText(/O teu espaço/i)).toBeInTheDocument()
    expect(screen.getByText(/no teu tempo/i)).toBeInTheDocument()
  })
  it('renders both CTAs', () => {
    render(<Hero />)
    expect(screen.getByRole('link', { name: /Ver Espaços/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Saber Mais/i })).toBeInTheDocument()
  })
})
