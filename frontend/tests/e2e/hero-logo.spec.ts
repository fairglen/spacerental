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
const headerLink = (page: Page) => page.locator('nav a[aria-label="FlowSpace"]').first()

/** The drawn content's box in the svg's user units, from the <use> itself. */
const drawnBox = (svg: import('@playwright/test').Locator) =>
  svg.evaluate((el) => {
    const b = (el.querySelector('use') as SVGGraphicsElement).getBBox()
    const [, , w, h] = el.getAttribute('viewBox')!.split(' ').map(Number)
    return { x: b.x, y: b.y, w: b.width, h: b.height, vw: w, vh: h }
  })

/**
 * B57: the drawing lies inside the viewBox and fills it. The brand files'
 * own viewBoxes carry a few units of padding around the path (8 on the
 * mark), so "fills" is ≥ 95 % of each side; before the fix the mark's box
 * started at −274 and the wordmark's at −147 — entirely outside.
 */
async function expectDrawnInsideItsBox(svg: import('@playwright/test').Locator, label: string) {
  const d = await drawnBox(svg)
  expect(d.x, `${label} bbox x`).toBeGreaterThanOrEqual(-1)
  expect(d.y, `${label} bbox y`).toBeGreaterThanOrEqual(-1)
  expect(d.x + d.w, `${label} bbox right`).toBeLessThanOrEqual(d.vw + 1)
  expect(d.y + d.h, `${label} bbox bottom`).toBeLessThanOrEqual(d.vh + 1)
  expect(d.w, `${label} bbox w`).toBeGreaterThanOrEqual(0.95 * d.vw)
  expect(d.h, `${label} bbox h`).toBeGreaterThanOrEqual(0.95 * d.vh)
}

const centre = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })

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
  test('B57: at 1280/1440/1920 every brand drawing fills its viewBox and the hero mark sits on the centre of its disc', async ({ page }) => {
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')
      for (const [name, svg] of [['header', headerLink(page).locator('svg')], ['hero mark', markColumn(page).locator('svg')]] as const) {
        await expectDrawnInsideItsBox(svg, `${width}px ${name}`)
      }
      const column = markColumn(page)
      const mark = centre((await column.locator('svg').boundingBox())!)
      // The disc is the column's ::before, 460px, centred on the column.
      const disc = await column.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const s = getComputedStyle(el, '::before')
        return { w: parseFloat(s.width), cx: r.left + r.width / 2, cy: r.top + r.height / 2 + window.scrollY }
      })
      expect(disc.w).toBe(460)
      expect(Math.abs(mark.x - disc.cx), `${width}px mark/disc x`).toBeLessThan(2)
      expect(Math.abs(mark.y - disc.cy), `${width}px mark/disc y`).toBeLessThan(2)
    }
  })

  test('B59: "FlowSpace" sits above the headline on one line at 390/768/1280/1440; the headline is unchanged', async ({ page }) => {
    for (const width of [390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')
      const brand = hero(page).locator('p.hero-brand')
      await expect(brand).toHaveText('FlowSpace')
      const h1 = hero(page).locator('h1')
      const [b, h] = [(await brand.boundingBox())!, (await h1.boundingBox())!]
      expect(b.y + b.height, `${width}px above the h1`).toBeLessThanOrEqual(h.y + 1)
      const lines = await brand.evaluate((el) => el.getClientRects().length)
      expect(lines, `${width}px one line`).toBe(1)
      expect(await brand.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('800')
      expect(await brand.locator('span').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(61, 122, 94)')
      await expect(h1).not.toContainText('FlowSpace')
    }
  })

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
