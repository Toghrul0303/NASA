/**
 * Typed build-time environment. FRONTEND_SPEC §2.1.
 * Empty string means same-origin for the API and data prefixes.
 */

/**
 * Direct HiPS roots for the base layer, tried in order.
 * Registry ids are not used: Aladin's CDS lookup fails and leaves the map blank.
 */
export const DEFAULT_HIPS_SURVEY_URLS = [
  'https://alasky.cds.unistra.fr/DSS/DSSColor',
  'https://casda.csiro.au/hips/DSS2/color',
  'https://hips.china-vo.org/m/CDS_P_DSS2_color',
] as const

/** Comma-separated default of `VITE_HIPS_SURVEY_BASE`. */
export const ALADIN_DEFAULT_SURVEY_ID = DEFAULT_HIPS_SURVEY_URLS.join(',')

/** Split `VITE_HIPS_SURVEY_BASE` into HiPS root URLs. Blank means the defaults above. */
export function hipsSurveyCandidates(value: string | undefined): readonly string[] {
  const source = value === undefined || value.trim() === '' ? ALADIN_DEFAULT_SURVEY_ID : value
  return source
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export interface RawEnv {
  VITE_API_BASE?: string
  VITE_DATA_BASE?: string
  VITE_HIPS_SURVEY_BASE?: string
  VITE_FEATURE_G1_CUBE?: string
  VITE_SPHEREX_CUBE_HIPS_URL?: string
  VITE_IRSA_SPECTROPHOTOMETRY_URL?: string
  VITE_IRSA_MOST_URL?: string
  /** `1` or `true` serves Tier 2 jobs from the captured samples. Unset uses the API. */
  VITE_USE_MOCKS?: string
  /** Milliseconds between mock queued, running, and complete. */
  VITE_MOCK_JOB_DELAY_MS?: string
}

export interface AppEnv {
  apiBase: string
  dataBase: string
  hipsSurveyBase: string
  featureG1Cube: boolean
  spherexCubeHipsUrl: string | undefined
  irsaSpectrophotometryUrl: string | undefined
  irsaMostUrl: string | undefined
  useMocks: boolean
  mockJobDelayMs: number
}

export function parseString(value: string | undefined, fallback: string): string {
  if (value === undefined || value.trim() === '') return fallback
  return value
}

export function parseOptional(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined
  return value.trim()
}

/** Non-negative milliseconds. Blank or invalid text keeps the fallback. */
export function parseDelayMs(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

/** Feature gates fail closed: only `true` and `1` enable them. */
export function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return fallback
}

export function readEnv(raw: RawEnv): AppEnv {
  return {
    apiBase: parseString(raw.VITE_API_BASE, ''),
    dataBase: parseString(raw.VITE_DATA_BASE, ''),
    hipsSurveyBase: parseString(raw.VITE_HIPS_SURVEY_BASE, ALADIN_DEFAULT_SURVEY_ID),
    featureG1Cube: parseBool(raw.VITE_FEATURE_G1_CUBE, false),
    spherexCubeHipsUrl: parseOptional(raw.VITE_SPHEREX_CUBE_HIPS_URL),
    irsaSpectrophotometryUrl: parseOptional(raw.VITE_IRSA_SPECTROPHOTOMETRY_URL),
    irsaMostUrl: parseOptional(raw.VITE_IRSA_MOST_URL),
    useMocks: parseBool(raw.VITE_USE_MOCKS, false),
    mockJobDelayMs: parseDelayMs(raw.VITE_MOCK_JOB_DELAY_MS, 800),
  }
}

export const env: AppEnv = readEnv(import.meta.env)
