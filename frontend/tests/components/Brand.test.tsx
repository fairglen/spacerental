import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { BrandSymbols } from '@/components/brand/BrandSymbols'
import { BRAND_MARK_ID, BRAND_WORDMARK_ID } from '@/components/brand/brandIds'
import { BrandMark } from '@/components/brand/BrandMark'
import { BrandWordmark } from '@/components/brand/BrandWordmark'
import { brandPaths } from '@/components/brand/brandPaths.generated'
import { brandBoxes } from '@/components/brand/brandBoxes.generated'

const ROOT = join(__dirname, '..', '..')

// B51: the inline brand — the generated path module is the brand files, the
// symbols are inlined once, the mark and the wordmark draw them by reference.
describe('brand symbols and their uses', () => {
  it('the drawers ship only the sizes: BrandMark/BrandWordmark import brandBoxes, never the path module (the landing JS budget)', () => {
    for (const file of ['BrandMark.tsx', 'BrandWordmark.tsx']) {
      const source = readFileSync(join(ROOT, 'components', 'brand', file), 'utf8')
      const imports = Array.from(source.matchAll(/from '([^']+)'/g), (m) => m[1])
      expect(imports, file).toContain('@/components/brand/brandBoxes.generated')
      expect(imports, file).not.toContain('@/components/brand/brandPaths.generated')
      expect(imports, file).not.toContain('@/components/brand/BrandSymbols') // its import graph carries the paths
    }
    expect(JSON.stringify(brandBoxes)).not.toContain('"d"')
    expect(brandBoxes.mark.viewBox).toBe(brandPaths.mark.viewBox)
    expect(brandBoxes.wordmark.viewBox).toBe(brandPaths.wordmark.viewBox)
  })

  it('brandPaths.generated.ts and brandBoxes.generated.ts are exactly what scripts/brand-paths.mjs renders from public/brand/', () => {
    // The script's --check is the drift guard; run it as the test.
    expect(() => execFileSync('node', [join(ROOT, 'scripts', 'brand-paths.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow()
    for (const [key, file] of [['mark', 'logo-mark.svg'], ['wordmark', 'wordmark.svg']] as const) {
      const svg = readFileSync(join(ROOT, 'public', 'brand', file), 'utf8')
      expect(svg).toContain(`viewBox="${brandPaths[key].viewBox}"`)
      expect(svg).toContain(`d="${brandPaths[key].d}"`)
      expect(svg).toContain('fill="currentColor"')
    }
  })

  it('<BrandSymbols> inlines the mark and the wordmark once, each as a currentColor path, without hiding them from <use>', () => {
    const { container } = render(<BrandSymbols />)
    const host = container.querySelector('svg')!
    expect(host).toHaveAttribute('aria-hidden', 'true')
    expect(host).toHaveAttribute('width', '0')
    expect(host).not.toHaveAttribute('hidden') // WebKit does not draw a <use> of a symbol in a display:none svg
    const symbols = host.querySelectorAll('symbol')
    expect(Array.from(symbols, (s) => s.id)).toEqual([BRAND_MARK_ID, BRAND_WORDMARK_ID])
    expect(symbols[0]).toHaveAttribute('viewBox', brandPaths.mark.viewBox)
    expect(symbols[0].querySelector('path')).toHaveAttribute('fill', 'currentColor')
    expect(symbols[0].querySelector('path')).toHaveAttribute('d', brandPaths.mark.d)
    expect(symbols[1]).toHaveAttribute('viewBox', brandPaths.wordmark.viewBox)
  })

  it('<BrandMark> is decorative, sized from its width with the viewBox ratio, and references the symbol', () => {
    const { container } = render(<BrandMark width={400} className="x" />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('width', '400')
    expect(svg).toHaveAttribute('height', String(Math.round((400 * 670.5) / 735.5))) // 365
    expect(svg).toHaveAttribute('viewBox', brandPaths.mark.viewBox)
    expect(svg.querySelector('use')).toHaveAttribute('href', `#${BRAND_MARK_ID}`)
    expect(svg).toHaveClass('x')
  })

  it('<BrandWordmark> is sized from its height and references the wordmark symbol', () => {
    const { container } = render(<BrandWordmark height={22} />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('height', '22')
    expect(svg).toHaveAttribute('width', String(Math.round((22 * 1018.5) / 216.5))) // 103
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg.querySelector('use')).toHaveAttribute('href', `#${BRAND_WORDMARK_ID}`)
  })
})
