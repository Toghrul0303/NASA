import { describe, expect, it } from 'vitest'
import { escapeHtml } from '../../src/map/gaiaOverlay'

describe('escapeHtml', () => {
  it('escapes &, <, >, and quotes before they are parsed as HTML', () => {
    expect(escapeHtml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f')
  })
})
