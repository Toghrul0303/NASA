import { describe, expect, it } from 'vitest'
import { communitySamples } from '../../src/config/communityMock'
import { roadmapSteps } from '../../src/config/copy'
import { isToolId } from '../../src/config/tools'
import { buildWorkspaceUrl, parseUrl } from '../../src/state/urlSync'
import { isValidSlug } from '../../src/contract/validate'

describe('community samples', () => {
  it('has four samples with a placeholder author', () => {
    expect(communitySamples).toHaveLength(4)
    for (const sample of communitySamples) expect(sample.author).toBe('Sample author')
  })

  it('links to Tier 1 permalinks that parse back to the same slug, tool and view', () => {
    for (const sample of communitySamples) {
      const href = buildWorkspaceUrl(
        { pathname: '/workspace', hash: '' },
        { ...sample.view, tool: sample.tool, slug: sample.slug, embed: false },
        [],
      )
      const parsed = parseUrl(href.slice(href.indexOf('?')))
      expect(isValidSlug(sample.slug)).toBe(true)
      expect(isToolId(sample.tool)).toBe(true)
      expect(parsed.slug).toBe(sample.slug)
      expect(parsed.tool).toBe(sample.tool)
      expect(parsed.ra).toBeCloseTo(sample.view.ra, 5)
      expect(parsed.dec).toBeCloseTo(sample.view.dec, 5)
      expect(parsed.fov).toBeCloseTo(sample.view.fov, 4)
    }
  })

  it('marks only Share as live in the roadmap', () => {
    expect(roadmapSteps.map((step) => [step.title, step.live])).toEqual([
      ['Share', true],
      ['Notebook', false],
      ['Community', false],
    ])
  })
})
