import catalog from './pt.json'

/**
 * Translate a key to its Portuguese value.
 *
 * Supports dot notation for nested keys, e.g. 't("hero.headline_start")'
 * Also supports string interpolation for placeholders like {year}, {name}, etc.
 *
 * @example
 * t('hero.badge') // 'Disponível à hora, por pacote ou recorrente'
 * t('footer.copyright', { year: 2025 }) // '© 2025 EspaçoHora. Todos os direitos reservados.'
 */
export function t(
  key: string,
  replacements?: Record<string, string | number>
): string {
  let value: unknown = catalog
  for (const part of key.split('.')) {
    value = value !== null && typeof value === 'object' && Object.hasOwn(value, part)
      ? (value as Record<string, unknown>)[part]
      : undefined
  }

  if (typeof value !== 'string') {
    console.warn(`Translation key not found: ${key}`)
    return key
  }

  // Apply string replacements if provided
  if (replacements) {
    return Object.entries(replacements).reduce((acc, [k, v]) => {
      return acc.split(`{${k}}`).join(String(v))
    }, value)
  }

  return value
}
