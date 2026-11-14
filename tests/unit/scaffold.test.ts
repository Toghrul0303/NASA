import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BAD_FLAG_NAMES,
  datasetErrors,
  framesNotFetched,
  glossary,
  jobErrors,
  jobWarnings,
  lineMarkerLabels,
  measuredMotionUnavailable,
  noFramesInWindow,
  photometry,
  recovery,
  slugNotes,
  verdictHeadlines,
  verdictUnavailableExplanation,
} from '../../src/config/copy'
import {
  ALIGN_GOOD_PX,
  ALIGN_POOR_PX,
  ASINH_SOFTENING,
  DECODE_CACHE_ITEMS,
  EPOCH_GAP_PX,
  EPOCH_MIN_SPAN_DAYS,
  FEATURE_MIN_FRAMES,
  FOV_MAX_DEG,
  FOV_MIN_DEG,
  JOB_SLOW_MS,
  LT_CELL_WIDTH_PX,
  LT_MIN_CELL_PX,
  S_CLIP,
  SIGNIFICANCE_CONTOUR,
  SSE_MAX_RECONNECTS,
  SSE_STALL_MS,
  STREAM_PREVIEW_MAX,
  URL_DEBOUNCE_MS,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../../src/config/constants'
import { ALADIN_DEFAULT_SURVEY_ID, parseBool, parseOptional, parseString, readEnv } from '../../src/config/env'
import { BLINK_SHORTCUTS, DIFF_MODE_LABELS, TOOL_IDS, isToolId, toolById } from '../../src/config/tools'
import packageJson from '../../package.json'
import tsconfig from '../../tsconfig.json'

describe('toolchain', () => {
  it('enforces strict TypeScript and noUncheckedIndexedAccess', () => {
    expect(tsconfig.compilerOptions.strict).toBe(true)
    expect(tsconfig.compilerOptions.noUncheckedIndexedAccess).toBe(true)
    expect(tsconfig.compilerOptions.target).toBe('ES2022')
  })

  it('pins the allowed runtime dependencies and excludes Next.js and Recharts', () => {
    expect(packageJson.dependencies['aladin-lite']).toBe('3.8.2')
    expect(packageJson.dependencies.react).toMatch(/^18\./)
    expect(packageJson.dependencies['react-dom']).toMatch(/^18\./)
    expect(packageJson.dependencies).toHaveProperty('zustand')
    expect(packageJson.dependencies).toHaveProperty('d3-scale')
    expect(packageJson.dependencies).toHaveProperty('d3-array')
    expect(packageJson.dependencies).toHaveProperty('d3-format')
    expect(packageJson.dependencies).not.toHaveProperty('next')
    expect(packageJson.dependencies).not.toHaveProperty('recharts')
    expect(packageJson.devDependencies).not.toHaveProperty('next')
    expect(packageJson.devDependencies.vite).toMatch(/^5\./)
    expect(packageJson.devDependencies.tailwindcss).toMatch(/^3\./)
    expect(packageJson.devDependencies.typescript).toMatch(/^5\./)
    expect(packageJson.devDependencies).toHaveProperty('vitest')
    expect(packageJson.devDependencies).toHaveProperty('eslint')
    expect(packageJson.devDependencies).toHaveProperty('prettier')
  })

  it('proxies /api and /data and emits source maps', () => {
    const viteConfig = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8')
    expect(viteConfig).toContain("'/api'")
    expect(viteConfig).toContain("'/data'")
    expect(viteConfig).toContain("target: proxyTarget")
    expect(viteConfig).toContain("const proxyTarget = 'http://localhost:8000'")
    expect(viteConfig).toContain('sourcemap: true')
  })
})

describe('constants', () => {
  it('matches FRONTEND_SPEC §16', () => {
    expect(ASINH_SOFTENING).toBe(0.1)
    expect(S_CLIP).toBe(5)
    expect(SIGNIFICANCE_CONTOUR).toBe(3)
    expect(ALIGN_GOOD_PX).toBe(0.3)
    expect(ALIGN_POOR_PX).toBe(0.5)
    expect(FEATURE_MIN_FRAMES).toBe(3)
    expect(DECODE_CACHE_ITEMS).toBe(64)
    expect(STREAM_PREVIEW_MAX).toBe(48)
    expect(SSE_MAX_RECONNECTS).toBe(8)
    expect(SSE_STALL_MS).toBe(45000)
    expect(JOB_SLOW_MS).toBe(60000)
    expect(URL_DEBOUNCE_MS).toBe(250)
    expect(EPOCH_MIN_SPAN_DAYS).toBe(1)
    expect(EPOCH_GAP_PX).toBe(24)
    expect(LT_CELL_WIDTH_PX).toBe(6)
    expect(LT_MIN_CELL_PX).toBe(3)
    expect(ZOOM_MIN).toBe(1)
    expect(ZOOM_MAX).toBe(32)
    expect(FOV_MIN_DEG).toBe(0.01)
    expect(FOV_MAX_DEG).toBe(180)
  })
})

describe('env', () => {
  it('applies the §2.1 defaults', () => {
    expect(readEnv({})).toEqual({
      apiBase: '',
      dataBase: '',
      hipsSurveyBase: ALADIN_DEFAULT_SURVEY_ID,
      featureG1Cube: false,
      spherexCubeHipsUrl: undefined,
      irsaSpectrophotometryUrl: undefined,
      irsaMostUrl: undefined,
    })
  })

  it('reads set values and fails the cube gate closed', () => {
    expect(parseString('  ', 'fallback')).toBe('fallback')
    expect(parseOptional('  ')).toBeUndefined()
    expect(parseOptional(' https://example.test ')).toBe('https://example.test')
    expect(parseBool(undefined, false)).toBe(false)
    expect(parseBool('true', false)).toBe(true)
    expect(parseBool('1', false)).toBe(true)
    expect(parseBool('false', true)).toBe(false)
    expect(parseBool('yes', false)).toBe(false)
    expect(
      readEnv({
        VITE_API_BASE: '/prefix',
        VITE_FEATURE_G1_CUBE: 'true',
        VITE_IRSA_MOST_URL: 'https://irsa.example/most',
      }).featureG1Cube,
    ).toBe(true)
  })
})

describe('tools', () => {
  it('lists the URL tool enum and blink shortcuts', () => {
    expect(TOOL_IDS).toEqual(['map', 'blink', 'diff', 'rgb', 'sed', 'gaia'])
    expect(isToolId('blink')).toBe(true)
    expect(isToolId('cube')).toBe(false)
    expect(toolById('map').closesLab).toBe(true)
    expect(toolById('gaia').label).toBe('Gaia check')
    expect(toolById('rgb').label).toBe('False-colour RGB')
    expect(Object.values(BLINK_SHORTCUTS)).toEqual(['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Space', '[', ']'])
    expect(DIFF_MODE_LABELS.temporal).toBe('Temporal difference (movers, variables)')
    expect(DIFF_MODE_LABELS.spectral).toBe('Spectral difference (colour excess)')
  })
})

describe('copy', () => {
  it('uses the verdict headlines, slug notes, and line-marker labels', () => {
    expect(verdictHeadlines).toEqual({
      match_consistent: 'Gaia match, motion consistent',
      match_inconsistent: 'Gaia match, motion inconsistent: possible blend or variability',
      no_counterpart: 'No Gaia counterpart',
      unavailable: 'Gaia query unavailable',
    })
    expect(verdictUnavailableExplanation).toBe('Gaia could not be queried; SPHEREx data are unaffected')
    expect(slugNotes['eps-indi-b']).toBe(
      'A close brown-dwarf pair: the components are blended at 6.15 arcsec per pixel. This is expected, not a tool failure.',
    )
    expect(slugNotes['wise-0855']).toBe('Extremely red and optically faint; an absent Gaia counterpart is plausible.')
    expect(lineMarkerLabels).toEqual({
      'Pa-beta': 'Pa\u03B2',
      'H-minus': 'H\u207B',
      'Pa-alpha': 'Pa\u03B1',
      'Br-gamma': 'Br\u03B3',
      'Br-beta': 'Br\u03B2',
      'PAH-3.3': 'PAH 3.3',
      'Br-alpha': 'Br\u03B1',
      CO: 'CO',
    })
    expect(photometry.quickLook).toBe('Quick-look from L2 cutouts')
    expect(photometry.notScienceGrade).toBe('Not science-grade photometry')
  })

  it('keeps the job, dataset, and recovery messages', () => {
    expect(jobErrors.not_found).toBe('Job not found or expired')
    expect(jobErrors.connection_lost).toBe('Connection lost')
    expect(jobErrors.no_coverage).toBe('No SPHEREx exposures overlap this position in the configured releases.')
    expect(jobWarnings.wavelength_gradient).toContain('per-frame lambda is evaluated at the target position')
    expect(datasetErrors.unsupported_version).toBe('unsupported data version')
    expect(measuredMotionUnavailable(3, 300)).toBe(
      'Not enough epochs or baseline for a motion fit (needs at least 3 epochs over 300 days)',
    )
    expect(framesNotFetched(4)).toBe('4 frames could not be fetched')
    expect(noFramesInWindow(3)).toBe('No frames for detector D3 in this window')
    expect(recovery.offline).toBe('You are offline')
    expect(recovery.goToTier1Targets).toBe('Go to Tier 1 targets')
  })

  it('defines every glossary term from §15.2 and links flags to the bad-bit names', () => {
    expect(glossary.map((entry) => entry.term)).toEqual([
      'LVF',
      'Epoch',
      'Detector and band',
      'Channel',
      'Contamination level',
      'Flags',
      'Dichroic',
      'MJy/sr',
      'mJy',
      'Asinh stretch',
    ])
    expect(BAD_FLAG_NAMES).toHaveLength(15)
    expect(BAD_FLAG_NAMES).toContain('DICHROIC')
    expect(BAD_FLAG_NAMES).not.toContain('SOURCE')
    const flags = glossary.find((entry) => entry.id === 'flags')
    expect(flags?.flagNames).toEqual(BAD_FLAG_NAMES)
  })
})
