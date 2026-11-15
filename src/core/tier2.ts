/**
 * Tier 2 job shapes and the request builder. No React and no DOM.
 * Field names and the three preset bodies are copied from TIER2_PRESETS.md.
 * `failed` is a job status the server sends; it is outside DATA_CONTRACT §11.4.
 * `partial` is a `result_status`, not a job status.
 */

export const SIZE_DEG_CHOICES = [0.05, 0.1, 0.2] as const

export type SizeDeg = (typeof SIZE_DEG_CHOICES)[number]

export const DEFAULT_SIZE_DEG: SizeDeg = 0.1

/** Job `status`. Includes `failed`, which §11.4 omits and the server sends. */
export type JobStatus = 'queued' | 'running' | 'complete' | 'failed'

/** `complete` event `result_status`, and `meta.status`. Not a job status. */
export type ResultStatus = 'complete' | 'partial'

export type FailedCode = 'no_coverage' | 'upstream_unavailable' | 'timeout' | 'internal_error'

/**
 * POST /api/jobs body. Only fields the caller set are present.
 * The server rounds coordinates and applies defaults; this module does not.
 */
export interface JobRequest {
  ra_deg: number
  dec_deg: number
  size_deg?: SizeDeg
  name?: string | null
  pmra_mas_yr?: number | null
  pmdec_mas_yr?: number | null
  coord_epoch_year?: number | null
  force_refresh?: boolean
}

/** `request` object echoed on a job after the server normalizes it. */
export interface NormalizedJobRequest {
  ra_deg: number
  dec_deg: number
  size_deg: SizeDeg
  name: string | null
  pmra_mas_yr: number | null
  pmdec_mas_yr: number | null
  coord_epoch_year: number
  coord_epoch_assumed: boolean
  force_refresh: boolean
}

export interface JobObject {
  job_id: string
  slug: string
  status: JobStatus
  cached: boolean
  joined: boolean
  created_utc: string
  events_url: string
  data_base_url: string
  request: NormalizedJobRequest
}

export interface JobErrorDetail {
  field: string
  issue: string
}

export interface JobErrorObject {
  code: string
  message: string
  details: readonly JobErrorDetail[]
}

export interface JobErrorEnvelope {
  error: JobErrorObject
}

export interface FileDigest {
  bytes: number
  sha256: string
}

/** SSE `complete` payload. `result_status` carries `partial`. */
export interface CompleteEvent {
  job_id: string
  slug: string
  result_status: ResultStatus
  data_base_url: string
  data_version: string
  n_frames: number
  n_epochs: number
  n_failed_fetches: number
  files: Readonly<Record<string, FileDigest>>
  elapsed_s: number
}

export interface FailedEvent {
  job_id: string
  code: string
  message: string
  retryable: boolean
  elapsed_s: number
}

export interface JobRequestOptions {
  name?: string | null
  pmraMasYr?: number | null
  pmdecMasYr?: number | null
  coordEpochYear?: number | null
  forceRefresh?: boolean
}

export type Tier2PresetId = 'wise-0855' | 'proxima-centauri' | 'epsilon-eridani'

export interface Tier2Preset {
  id: Tier2PresetId
  /** Display name. Matches the `name` field on the body. */
  label: string
  /** Dataset slug this body maps to once the job is finished. */
  slug: string
  /**
   * False means the preset may fail while IRSA is unstable.
   * The safe preset is the default and the only one without that warning.
   */
  safe: boolean
  body: JobRequest
}

/**
 * Build a POST body. Values are copied through.
 * Rounding, defaulting, and null-vs-omitted normalization belong to the server.
 * An option is included only when the caller passed it (`undefined` omits it).
 */
export function buildJobRequest(
  raDeg: number,
  decDeg: number,
  sizeDeg: SizeDeg,
  options?: JobRequestOptions,
): JobRequest {
  const body: JobRequest = {
    ra_deg: raDeg,
    dec_deg: decDeg,
    size_deg: sizeDeg,
  }
  if (!options) return body
  if (options.name !== undefined) body.name = options.name
  if (options.pmraMasYr !== undefined) body.pmra_mas_yr = options.pmraMasYr
  if (options.pmdecMasYr !== undefined) body.pmdec_mas_yr = options.pmdecMasYr
  if (options.coordEpochYear !== undefined) body.coord_epoch_year = options.coordEpochYear
  if (options.forceRefresh !== undefined) body.force_refresh = options.forceRefresh
  return body
}

/** Safe demo preset. Both proper motions are required; without them the slug changes. */
export const PRESET_WISE_0855: JobRequest = {
  ra_deg: 133.795129,
  dec_deg: -7.245147,
  size_deg: 0.1,
  name: 'WISE 0855 coord',
  pmra_mas_yr: -8120,
  pmdec_mas_yr: 679,
}

export const PRESET_PROXIMA: JobRequest = {
  ra_deg: 217.42894,
  dec_deg: -62.67949,
  size_deg: 0.1,
  name: 'Proxima Centauri',
}

export const PRESET_EPSILON: JobRequest = {
  ra_deg: 53.23268,
  dec_deg: -9.45826,
  size_deg: 0.1,
  name: 'Epsilon Eridani',
}

export const TIER2_PRESETS: readonly Tier2Preset[] = [
  {
    id: 'wise-0855',
    label: 'WISE 0855 coord',
    slug: 'c-a55d19970b4b8fd7',
    safe: true,
    body: PRESET_WISE_0855,
  },
  {
    id: 'proxima-centauri',
    label: 'Proxima Centauri',
    slug: 'c-843ee254e3d6b9be',
    safe: false,
    body: PRESET_PROXIMA,
  },
  {
    id: 'epsilon-eridani',
    label: 'Epsilon Eridani',
    slug: 'c-c8a384476c0ae479',
    safe: false,
    body: PRESET_EPSILON,
  },
]

/** The safe preset. It is the default and the only preset without a failure warning. */
export const SAFE_TIER2_PRESET: Tier2Preset = TIER2_PRESETS.find((preset) => preset.safe) ?? {
  id: 'wise-0855',
  label: 'WISE 0855 coord',
  slug: 'c-a55d19970b4b8fd7',
  safe: true,
  body: PRESET_WISE_0855,
}

export function tier2PresetById(id: Tier2PresetId): Tier2Preset {
  const found = TIER2_PRESETS.find((preset) => preset.id === id)
  return found ?? SAFE_TIER2_PRESET
}

/**
 * Captured invalid body. `size_deg` 0.3 is outside the union on purpose.
 * POST of this body is rejected with 422 and does not call IRSA.
 */
export const INVALID_SIZE_BODY = {
  ra_deg: 1,
  dec_deg: 2,
  size_deg: 0.3,
} as const

/** Cached WISE job. Captured POST /api/jobs, HTTP 200. */
export const CACHED_WISE_JOB: JobObject = {
  job_id: 'j_0ef172fd2b181ffe',
  slug: 'c-a55d19970b4b8fd7',
  status: 'complete',
  cached: true,
  joined: false,
  created_utc: '2026-11-14T16:41:38.156Z',
  events_url: '/api/jobs/j_0ef172fd2b181ffe/events',
  data_base_url: '/data/c-a55d19970b4b8fd7/',
  request: {
    ra_deg: 133.795129,
    dec_deg: -7.245147,
    size_deg: 0.1,
    name: 'WISE 0855 coord',
    pmra_mas_yr: -8120.0,
    pmdec_mas_yr: 679.0,
    coord_epoch_year: 2000.0,
    coord_epoch_assumed: true,
    force_refresh: false,
  },
}

/**
 * Queued, running, and partial samples were never captured from the real server.
 * The queued object is the DATA_CONTRACT §11.4 example. Running is that example
 * with `status` set to `running`. Partial is the §12.3 `complete` example with
 * `result_status` `partial` and `n_failed_fetches` 1.
 */
export const SPEC_QUEUED_JOB: JobObject = {
  job_id: 'j_3f9a1c07b2d4e581',
  slug: 'c-8e21b4d0a97c3f56',
  status: 'queued',
  cached: false,
  joined: false,
  created_utc: '2026-11-15T10:02:11.482Z',
  events_url: '/api/jobs/j_3f9a1c07b2d4e581/events',
  data_base_url: '/data/c-8e21b4d0a97c3f56/',
  request: {
    ra_deg: 210.80227,
    dec_deg: 54.34895,
    size_deg: 0.1,
    name: null,
    pmra_mas_yr: null,
    pmdec_mas_yr: null,
    coord_epoch_year: 2000.0,
    coord_epoch_assumed: true,
    force_refresh: false,
  },
}

export const SPEC_RUNNING_JOB: JobObject = {
  ...SPEC_QUEUED_JOB,
  status: 'running',
}

export const SPEC_COMPLETE_EVENT: CompleteEvent = {
  job_id: 'j_3f9a1c07b2d4e581',
  slug: 'c-8e21b4d0a97c3f56',
  result_status: 'complete',
  data_base_url: '/data/c-8e21b4d0a97c3f56/',
  data_version: 'sha256:00000000000000000000000000000000000000000000000000000000000000aa',
  n_frames: 413,
  n_epochs: 7,
  n_failed_fetches: 0,
  files: {
    'meta.json': {
      bytes: 18234,
      sha256: '00000000000000000000000000000000000000000000000000000000000000bb',
    },
  },
  elapsed_s: 96.3,
}

/** Not captured. Built from the §12.3 complete example; see the comment above SPEC_QUEUED_JOB. */
export const SPEC_PARTIAL_EVENT: CompleteEvent = {
  ...SPEC_COMPLETE_EVENT,
  result_status: 'partial',
  n_failed_fetches: 1,
}

/** Captured invalid body, HTTP 422. */
export const INVALID_SIZE_ERROR: JobErrorEnvelope = {
  error: {
    code: 'invalid_request',
    message: 'Request validation failed.',
    details: [{ field: 'size_deg', issue: 'must be one of 0.05, 0.1, 0.2' }],
  },
}

/** Captured failed fixture. GET /api/jobs/j_fixtfa11ed000001 returned HTTP 200 with `status` `failed`. */
export const FAILED_FIXTURE_JOB: JobObject = {
  job_id: 'j_fixtfa11ed000001',
  slug: 'c-fixturefailed01',
  status: 'failed',
  cached: false,
  joined: false,
  created_utc: '2026-11-15T06:00:00.000Z',
  events_url: '/api/jobs/j_fixtfa11ed000001/events',
  data_base_url: '/data/c-fixturefailed01/',
  request: {
    ra_deg: 1.0,
    dec_deg: 1.0,
    size_deg: 0.1,
    name: 'fixture failed',
    pmra_mas_yr: null,
    pmdec_mas_yr: null,
    coord_epoch_year: 2000.0,
    coord_epoch_assumed: true,
    force_refresh: false,
  },
}

/** Captured `failed` event for the fixture job. The code and message live here, not on the job object. */
export const FAILED_FIXTURE_EVENT: FailedEvent = {
  job_id: 'j_fixtfa11ed000001',
  code: 'upstream_unavailable',
  message: 'Fixture: IRSA was not called.',
  retryable: true,
  elapsed_s: 1.0,
}

/**
 * A finished job is opened by its `slug`. The workspace URL keeps the existing
 * `slug` parameter. Files are loaded from `data_base_url` (`/data/{slug}/`).
 */
export function datasetSlugForJob(job: JobObject): string {
  return job.slug
}

export function isSizeDeg(value: unknown): value is SizeDeg {
  return value === 0.05 || value === 0.1 || value === 0.2
}

export function isJobStatus(value: unknown): value is JobStatus {
  return value === 'queued' || value === 'running' || value === 'complete' || value === 'failed'
}

export function isResultStatus(value: unknown): value is ResultStatus {
  return value === 'complete' || value === 'partial'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

/**
 * Fixture id `j_fixtfa11ed000001` is 16 lowercase letters, not all hex.
 * §11.4 asks for `^j_[0-9a-f]{16}$`. The captured fixture is accepted here.
 */
function isJobId(value: unknown): value is string {
  return typeof value === 'string' && /^j_[a-z0-9]{16}$/.test(value)
}

function isSlug(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(value)
}

function isNormalizedRequest(value: unknown): value is NormalizedJobRequest {
  if (!isRecord(value)) return false
  return (
    isFiniteNumber(value.ra_deg) &&
    isFiniteNumber(value.dec_deg) &&
    isSizeDeg(value.size_deg) &&
    isNullableString(value.name) &&
    isNullableNumber(value.pmra_mas_yr) &&
    isNullableNumber(value.pmdec_mas_yr) &&
    isFiniteNumber(value.coord_epoch_year) &&
    typeof value.coord_epoch_assumed === 'boolean' &&
    typeof value.force_refresh === 'boolean'
  )
}

export function isJobObject(value: unknown): value is JobObject {
  if (!isRecord(value)) return false
  return (
    isJobId(value.job_id) &&
    isSlug(value.slug) &&
    isJobStatus(value.status) &&
    typeof value.cached === 'boolean' &&
    typeof value.joined === 'boolean' &&
    typeof value.created_utc === 'string' &&
    typeof value.events_url === 'string' &&
    typeof value.data_base_url === 'string' &&
    isNormalizedRequest(value.request)
  )
}

function isDetail(value: unknown): value is JobErrorDetail {
  if (!isRecord(value)) return false
  return typeof value.field === 'string' && typeof value.issue === 'string'
}

export function isJobErrorEnvelope(value: unknown): value is JobErrorEnvelope {
  if (!isRecord(value)) return false
  const error = value.error
  if (!isRecord(error)) return false
  if (typeof error.code !== 'string' || typeof error.message !== 'string') return false
  if (!Array.isArray(error.details)) return false
  return error.details.every(isDetail)
}

export function isCompleteEvent(value: unknown): value is CompleteEvent {
  if (!isRecord(value)) return false
  if (!isJobId(value.job_id) || !isSlug(value.slug) || !isResultStatus(value.result_status)) return false
  if (typeof value.data_base_url !== 'string' || typeof value.data_version !== 'string') return false
  if (!isFiniteNumber(value.n_frames) || !isFiniteNumber(value.n_epochs)) return false
  if (!isFiniteNumber(value.n_failed_fetches) || !isFiniteNumber(value.elapsed_s)) return false
  if (!isRecord(value.files)) return false
  return Object.values(value.files).every(isFileDigest)
}

function isFileDigest(value: unknown): value is FileDigest {
  if (!isRecord(value)) return false
  return isFiniteNumber(value.bytes) && typeof value.sha256 === 'string'
}

export function isFailedEvent(value: unknown): value is FailedEvent {
  if (!isRecord(value)) return false
  return (
    isJobId(value.job_id) &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    typeof value.retryable === 'boolean' &&
    isFiniteNumber(value.elapsed_s)
  )
}

export function isInvalidSizeBody(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    value.ra_deg === INVALID_SIZE_BODY.ra_deg && value.dec_deg === INVALID_SIZE_BODY.dec_deg && value.size_deg === 0.3
  )
}

export function isExactPresetBody(value: unknown, preset: JobRequest): boolean {
  if (!isRecord(value)) return false
  const keys = Object.keys(preset)
  if (Object.keys(value).length !== keys.length) return false
  return keys.every((key) => value[key] === preset[key as keyof JobRequest])
}
