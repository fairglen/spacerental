import { beforeAll, describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/i18n/pt.json', () => ({
  default: { sample: { nested: 'Olá', repeated: '{name}: {name} ({count})' } },
}))

// tests/setup.ts already loaded the real catalog into the registry (B65);
// a fresh module graph is the one that sees the mock above.
let t: typeof import('@/lib/i18n').t
beforeAll(async () => {
  vi.resetModules()
  ;({ t } = await import('@/lib/i18n'))
})

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
