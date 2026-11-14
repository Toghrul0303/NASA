// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  gaiaCopy,
  measuredMotionUnavailable,
  verdictHeadlines,
  verdictUnavailableExplanation,
} from '../../src/config/copy'
import { validateGaia, validateMeta } from '../../src/contract/validate'
import { GAIA_SAMPLE_KINDS, GAIA_SAMPLE_SOURCE_ID, makeGaiaSample } from '../../src/dev/gaiaSamples'
import { GaiaPanel } from '../../src/lab/tools/GaiaPanel'

const fixtureDir = resolve(process.cwd(), 'public/data/fixture-barnard')

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixtureDir, name), 'utf8')) as unknown
}

const meta = validateMeta(readJson('meta.json'), 'fixture-barnard')
const baseGaia = validateGaia(readJson('gaia.json'))

function renderGaia(gaia: typeof baseGaia): string {
  return renderToStaticMarkup(<GaiaPanel meta={meta} gaia={gaia} />)
}

describe('Gaia panel', () => {
  it('renders each verdict headline and leaves verdict_detail unchanged', () => {
    for (const kind of GAIA_SAMPLE_KINDS) {
      const sample = makeGaiaSample(baseGaia, kind)
      const html = renderGaia(sample)
      expect(html).toContain(verdictHeadlines[sample.verdict])
      expect(html).toContain(baseGaia.verdict_detail)
      expect(sample.verdict_detail).toBe(baseGaia.verdict_detail)
    }
  })

  it('hides the sources table and measured motion when the query is unavailable', () => {
    const html = renderGaia(makeGaiaSample(baseGaia, 'unavailable'))
    expect(html).toContain(verdictHeadlines.unavailable)
    expect(html).toContain(verdictUnavailableExplanation)
    expect(html).not.toContain('data-block="sources"')
    expect(html).not.toContain('data-block="measured-motion"')
    expect(html).not.toContain('<table')
  })

  it('prints the 19-digit source id as a string', () => {
    const html = renderGaia(makeGaiaSample(baseGaia, 'consistent'))
    expect(html).toContain(GAIA_SAMPLE_SOURCE_ID)
    expect(html).not.toContain('4472832130942576000')
    expect(html).not.toContain('4.472832130942576e+18')
  })

  it('explains a missing motion fit with the thresholds from meta.processing', () => {
    expect(baseGaia.measured_pm).toBeNull()
    const html = renderGaia(baseGaia)
    expect(html).toContain(
      measuredMotionUnavailable(meta.processing.pm_fit_min_epochs, meta.processing.pm_fit_min_baseline_days),
    )
  })

  it('draws no comparison plot when consistency is null', () => {
    expect(baseGaia.consistency).toBeNull()
    const html = renderGaia(baseGaia)
    expect(html).not.toContain('data-gaia-plot')
    expect(html).toContain(gaiaCopy.measuredMotionMissing)
  })

  it('plots a consistent match as within 3 sigma', () => {
    const html = renderGaia(makeGaiaSample(baseGaia, 'consistent'))
    expect(html).toContain('data-gaia-plot="true"')
    expect(html).toContain(gaiaCopy.within3SigmaYes)
    expect(html).not.toContain(gaiaCopy.within3SigmaNo)
  })

  it('plots an inconsistent match as outside 3 sigma', () => {
    const html = renderGaia(makeGaiaSample(baseGaia, 'inconsistent'))
    expect(html).toContain('data-gaia-plot="true"')
    expect(html).toContain(gaiaCopy.within3SigmaNo)
  })
})
