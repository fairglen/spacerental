import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Hero } from '@/components/landing/Hero'
import { t } from '@/lib/i18n'

describe('Hero navigation', () => {
  it('keeps translated calls to action linked to browsing and instructions', () => {
    render(<Hero />)
    expect(screen.getByRole('link', { name: t('hero.cta_primary') })).toHaveAttribute('href', '/spaces')
    expect(screen.getByRole('link', { name: t('hero.cta_secondary') })).toHaveAttribute('href', '/#como-funciona')
  })
})
