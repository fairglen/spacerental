import { describe, it, expect, vi } from 'vitest'
import { t } from '@/lib/i18n'

describe('i18n translation function (9.1)', () => {
  it('retrieves a nested translation key', () => {
    expect(t('hero.badge')).toBe('Disponível à hora, por pacote ou recorrente')
    expect(t('hero.headline_start')).toBe('O teu espaço,')
    expect(t('hero.headline_highlight')).toBe('no teu tempo')
  })

  it('retrieves translations from other sections', () => {
    expect(t('pricing.section_title')).toBe('Preços Transparentes')
    expect(t('howItWorks.section_title')).toBe('Como Funciona')
    expect(t('valueProps.privacy_title')).toBe('Privacidade Total')
    expect(t('spaceCards.section_title')).toBe('Espaços Disponíveis')
    expect(t('navbar.spaces_link')).toBe('Espaços')
    expect(t('footer.tagline')).toBe('Espaços profissionais por hora para psicólogos, terapeutas e outros profissionais de saúde.')
  })

  it('supports string interpolation with replacements', () => {
    const result = t('footer.copyright', { year: 2026 })
    expect(result).toBe('© 2026 EspaçoHora. Todos os direitos reservados.')
  })

  it('returns the key itself when translation is not found (with console.warn)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = t('nonexistent.key')
    expect(result).toBe('nonexistent.key')
    expect(warnSpy).toHaveBeenCalledWith('Translation key not found: nonexistent.key')
    warnSpy.mockRestore()
  })
})
