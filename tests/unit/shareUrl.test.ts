import { describe, expect, it } from 'vitest'
import { buildEmbedCode, buildEmbedUrl, buildShareLink } from '../../src/state/shareUrl'

const BASE = 'http://localhost:4173/workspace?ra=133.795129&dec=-7.245147&fov=0.5&tool=blink&slug=c-a55d19970b4b8fd7'

describe('share links', () => {
  it('keeps the current state and leaves embed out', () => {
    expect(buildShareLink(BASE, 'c-a55d19970b4b8fd7')).toBe(BASE)
    expect(buildShareLink(`${BASE}&embed=1`, null)).toBe(BASE)
  })

  it('fills in a missing slug only when it is valid', () => {
    const bare = 'http://localhost:4173/workspace?ra=1&dec=2&fov=0.5'
    expect(buildShareLink(bare, 'barnards-star')).toBe(`${bare}&slug=barnards-star`)
    expect(buildShareLink(bare, 'Bad Slug!')).toBe(bare)
  })

  it('adds embed=1 after slug and before unknown parameters', () => {
    const url = buildEmbedUrl('http://x.test/workspace?devGaia=a&slug=barnards-star&tool=sed&ra=1&dec=2&fov=0.5', null)
    expect(url).toBe('http://x.test/workspace?ra=1&dec=2&fov=0.5&tool=sed&slug=barnards-star&embed=1&devGaia=a')
  })

  it('builds an iframe with width 100%, height 640 and a title, escaping attributes', () => {
    const code = buildEmbedCode(buildEmbedUrl(BASE, null), 'ExoTrace "Lab" <x>')
    expect(code).toContain('width="100%"')
    expect(code).toContain('height="640"')
    expect(code).toContain('title="ExoTrace &quot;Lab&quot; &lt;x&gt;"')
    expect(code).toContain('&amp;embed=1')
    expect(code.startsWith('<iframe ')).toBe(true)
    expect(code.endsWith('</iframe>')).toBe(true)
  })
})
