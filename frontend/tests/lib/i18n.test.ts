import { describe, it, expect, vi } from 'vitest'
import { t } from '@/lib/i18n'

vi.mock('@/lib/i18n/pt.json', () => ({
  default: { sample: { nested: 'Olá', repeated: '{name}: {name} ({count})' } },
}))

describe('translation lookup', () => {
  it('resolves nested strings', () => {
    expect(t('sample.nested')).toBe('Olá')
  })

  it('replaces every placeholder and preserves literal replacement text', () => {
    expect(t('sample.repeated', { name: '$&', count: 2 })).toBe('$&: $& (2)')
  })

  it.each(['missing.key', 'sample', 'sample.nested.length', '__proto__.constructor'])('reports an invalid key: %s', (key) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(t(key)).toBe(key)
      expect(warn).toHaveBeenCalledWith(`Translation key not found: ${key}`)
    } finally {
      warn.mockRestore()
    }
  })
})
