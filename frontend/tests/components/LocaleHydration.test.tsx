import { afterEach, describe, expect, it } from 'vitest'
import { act } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'
import { setLocale, useT } from '@/lib/i18n'

function TranslatedLink() {
  const t = useT()
  return <a href="/spaces">{t('navbar.spaces_link')}</a>
}

afterEach(() => {
  setLocale('pt')
  localStorage.clear()
})

describe('locale hydration', () => {
  it('hydrates Portuguese server HTML before applying the saved English choice', async () => {
    const container = document.createElement('div')
    setLocale('pt')
    container.innerHTML = renderToString(<TranslatedLink />)
    document.body.append(container)
    setLocale('en')
    const errors: unknown[] = []
    let root: Root | undefined
    try {
      await act(async () => {
        root = hydrateRoot(container, <TranslatedLink />, {
          onRecoverableError: (error) => errors.push(error),
        })
      })
      expect(container.textContent).toBe('Spaces')
      expect(errors).toEqual([])
    } finally {
      await act(async () => root?.unmount())
      container.remove()
    }
  })
})
