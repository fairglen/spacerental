import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

// B51: the brand mark is the hero illustration from 1024px and a watermark
// under it; the header shows the wordmark alone — the same numbers as the
// static site's smoke suite asserts, so the two stay pixel-equivalent.
const WCAG = {
  luminance([r, g, b]: number[]) {
    const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  },
  contrast(a: number[], b: number[]) {
    const [l1, l2] = [WCAG.luminance(a), WCAG.luminance(b)].sort((x, y) => y - x)
    return (l1 + 0.05) / (l2 + 0.05)
  },
  parse(css: string): number[] { return css.match(/[\d.]+/g)!.slice(0, 3).map(Number) },
  over(top: number[], alpha: number, under: number[]) { return top.map((c, i) => Math.round(alpha * c + (1 - alpha) * under[i])) },
}

const hero = (page: Page) => page.locator('main section').first()
const markColumn = (page: Page) => page.getByTestId('hero-mark')
const watermark = (page: Page) => hero(page).locator('svg.lg\\:hidden')

test.describe('hero brand mark', () => {
  test('the header link is named and carries the wordmark alone, 22px tall', async ({ page }) => {
    await page.goto('/')
    const link = page.locator('nav a[aria-label="FlowSpace"]').first()
    const svg = link.locator('svg')
    await expect(svg).toHaveCount(1)
    await expect(svg).toHaveAttribute('aria-hidden', 'true')
    await expect(svg).toHaveAttribute('height', '22')
    await expect(svg.locator('use')).toHaveAttribute('href', '#brand-wordmark')
    expect((await svg.boundingBox())!.height).toBe(22)
    await expect(link.locator('use[href="#brand-mark"], use[href*="lockup"]')).toHaveCount(0)
    // The symbols are inlined once, first thing in the body.
    await expect(page.locator('body > svg[aria-hidden="true"] symbol')).toHaveCount(2)
  })

  test('at 1440 the mark is centred in the right column over its disc; no watermark', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    const column = markColumn(page)
    await expect(column).toBeVisible()
    await expect(column).toHaveAttribute('aria-hidden', 'true')
    const mark = column.locator('svg')
    await expect(mark).toHaveAttribute('width', '400')
    await expect(mark).toHaveAttribute('height', '365')
    await expect(mark.locator('use')).toHaveAttribute('href', '#brand-mark')
    const [columnBox, markBox] = [(await column.boundingBox())!, (await mark.boundingBox())!]
    expect(markBox.width).toBe(400)
    expect(columnBox.height).toBeGreaterThanOrEqual(420)
    expect(Math.abs(columnBox.x + columnBox.width / 2 - (markBox.x + markBox.width / 2))).toBeLessThan(1)
    expect(Math.abs(columnBox.y + columnBox.height / 2 - (markBox.y + markBox.height / 2))).toBeLessThan(1)
    expect(await mark.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(61, 122, 94)')
    const grid = column.locator('xpath=..')
    expect((await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns)).split(' ')).toHaveLength(2)
    expect(await grid.evaluate((el) => getComputedStyle(el).columnGap)).toBe('32px')
    expect((await grid.locator('> :first-child').boundingBox())!.width).toBe(768)
    const disc = await column.evaluate((el) => { const s = getComputedStyle(el, '::before'); return [s.width, s.height, s.borderRadius, s.pointerEvents, s.backgroundImage] })
    // `rounded-full`: 9999px on Tailwind 3, `calc(infinity * 1px)` on 4 — a circle either way.
    expect(disc.slice(0, 2)).toEqual(['460px', '460px'])
    expect(parseFloat(disc[2] as string)).toBeGreaterThanOrEqual(230)
    expect(disc[3]).toBe('none')
    expect(disc[4]).toContain('radial-gradient')
    expect(disc[4]).toContain('rgba(168, 213, 186, 0.55)')
    await expect(watermark(page)).toBeHidden()
  })

  test('at 390 the watermark bleeds off the bottom-right behind the text; the column is gone; nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await expect(markColumn(page)).toBeHidden()
    const wm = watermark(page)
    await expect(wm).toHaveAttribute('aria-hidden', 'true')
    await expect(wm).toHaveAttribute('width', '440')
    await expect(wm.locator('use')).toHaveAttribute('href', '#brand-mark')
    const style = await wm.evaluate((el) => { const s = getComputedStyle(el); return [s.display, s.position, s.right, s.bottom, s.width, s.opacity, s.pointerEvents, s.color] })
    expect(style).toEqual(['block', 'absolute', '-112px', '-48px', '440px', '0.08', 'none', 'rgb(61, 122, 94)'])
    // The token's value, however the CSS pipeline spells it (`0.08`, or `.08` once minified).
    expect(parseFloat(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--hero-watermark-opacity').trim()))).toBe(0.08)
    const [heroBox, wmBox] = [(await hero(page).boundingBox())!, (await wm.boundingBox())!]
    expect(wmBox.x + wmBox.width).toBeGreaterThan(heroBox.x + heroBox.width)
    expect(wmBox.y + wmBox.height).toBeGreaterThan(heroBox.y + heroBox.height)
    expect(await hero(page).evaluate((el) => getComputedStyle(el).overflow)).toBe('hidden')
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBe(390)
    for (const el of await hero(page).locator('a, h1').all()) {
      const box = (await el.boundingBox())!
      const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('svg.lg\\:hidden') !== null, [box.x + box.width / 2, box.y + box.height / 2])
      expect(hit).toBe(false)
    }
  })

  test('at 390 the text over the watermark keeps its contrast', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    const body = WCAG.parse(await page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    const darkest = WCAG.over([168, 213, 186], 0.3, body) // `to-primary-light/30`
    const wm = watermark(page)
    const opacity = Number(await wm.evaluate((el) => getComputedStyle(el).opacity))
    const primary = WCAG.parse(await wm.evaluate((el) => getComputedStyle(el).color))
    const overWatermark = WCAG.over(primary, opacity, darkest)
    const wmBox = (await wm.boundingBox())!
    const results: Record<string, { plain: number; watermark: number }> = {}
    const h = hero(page)
    for (const [name, locator] of [
      ['h1', h.locator('h1')], ['lede', h.locator('p').nth(0)], ['support', h.locator('p').nth(1)],
      ['primary button', h.locator('a').nth(0).locator('button')], ['outline button', h.locator('a').nth(1).locator('button')],
      ['benefit', h.locator('.rounded-full').first().locator('xpath=..')],
    ] as const) {
      const el = locator.first()
      const [color, bg] = await el.evaluate((node) => { const s = getComputedStyle(node); return [s.color, s.backgroundColor] })
      const box = (await el.boundingBox())!
      const intersects = box.x < wmBox.x + wmBox.width && box.x + box.width > wmBox.x && box.y < wmBox.y + wmBox.height && box.y + box.height > wmBox.y
      const ownBackground = !/rgba\(0, 0, 0, 0\)|transparent/.test(bg) ? WCAG.parse(bg) : null
      const plain = WCAG.contrast(WCAG.parse(color), ownBackground ?? darkest)
      const over = WCAG.contrast(WCAG.parse(color), ownBackground ?? (intersects ? overWatermark : darkest))
      results[name] = { plain: Math.round(plain * 100) / 100, watermark: Math.round(over * 100) / 100 }
    }
    console.log('hero contrast at 390 (plain → over the watermark):', JSON.stringify(results))
    expect(results.h1.watermark).toBeGreaterThanOrEqual(4.5)
    expect(results['primary button'].watermark).toBeGreaterThanOrEqual(4.5)
    for (const [name, r] of Object.entries(results)) {
      expect(r.plain - r.watermark, name).toBeLessThan(0.5)
      if (r.plain >= 4.5) expect(r.watermark, name).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('the hero shifts nothing while it loads (CLS 0) at 1440 and 390', async ({ page }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/', { waitUntil: 'networkidle' })
      const shifts = await page.evaluate(() => new Promise<number>((resolve) => {
        const section = document.querySelector('main section')!
        let sum = 0
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & { hadRecentInput: boolean; value: number; sources?: { node?: Node }[] })[]) {
            if (entry.hadRecentInput) continue
            if ((entry.sources ?? []).some((s) => s.node && section.contains(s.node))) sum += entry.value
          }
        })
        observer.observe({ type: 'layout-shift', buffered: true })
        setTimeout(() => { observer.disconnect(); resolve(sum) }, 600)
      }))
      expect(shifts, `${width}px`).toBe(0)
    }
  })
})
