import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// B50: the app serves a copy of the static site's brand set from
// `public/brand/`. Same file names, same bytes — the two cannot drift.
const SOURCE = join(__dirname, '..', '..', '..', 'flowspace-site', 'assets', 'img', 'brand')
const COPY = join(__dirname, '..', '..', 'public', 'brand')

const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('brand set parity', () => {
  it('public/brand/ holds every file of flowspace-site/assets/img/brand/, byte for byte', () => {
    const source = readdirSync(SOURCE).sort()
    const copy = readdirSync(COPY).sort()
    expect(copy).toEqual(source)
    expect(source).toContain('logo-horizontal.svg')
    expect(source).toContain('og-image.png')
    for (const name of source) {
      expect(sha(join(COPY, name)), `${name} differs from the static site's copy`).toBe(sha(join(SOURCE, name)))
    }
  })

  it('the lockup is a currentColor SVG with the id the sites reference through <use>', () => {
    const svg = readFileSync(join(SOURCE, 'logo-horizontal.svg'), 'utf8')
    expect(svg).toMatch(/viewBox="0 0 [\d.]+ [\d.]+"/)
    expect(svg).toContain('id="lockup"')
    expect(svg).toContain('fill="currentColor"')
    expect(svg).not.toMatch(/fill="#/)
  })
})
