import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TheSpace } from '@/components/landing/TheSpace'
import { t } from '@/lib/i18n'

describe('TheSpace section (W03)', () => {
  it('is a labelled section with a level-2 heading and two catalog paragraphs', () => {
    render(<TheSpace />)
    const heading = screen.getByRole('heading', { level: 2, name: t('theSpace.title') })
    expect(heading).toBeInTheDocument()
    expect(screen.getByRole('region', { name: t('theSpace.title') })).toHaveAttribute('id', 'o-espaco')
    expect(screen.getByText(t('theSpace.p1'))).toBeInTheDocument()
    expect(screen.getByText(t('theSpace.p2'))).toBeInTheDocument()
  })
})
