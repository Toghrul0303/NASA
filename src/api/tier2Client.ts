/**
 * POST /api/jobs. One request per run. F15 does not poll and does not open the event stream.
 * The mock returns the captured samples from TIER2_PRESETS.md. Queued, running, and partial
 * were not captured; those objects are built in core/tier2.ts from DATA_CONTRACT §11.4 and §12.3.
 */
import {
  CACHED_WISE_JOB,
  FAILED_FIXTURE_EVENT,
  FAILED_FIXTURE_JOB,
  INVALID_SIZE_BODY,
  INVALID_SIZE_ERROR,
  PRESET_WISE_0855,
  SPEC_COMPLETE_EVENT,
  SPEC_PARTIAL_EVENT,
  SPEC_QUEUED_JOB,
  SPEC_RUNNING_JOB,
  isExactPresetBody,
  isInvalidSizeBody,
  isJobErrorEnvelope,
  isJobObject,
  type CompleteEvent,
  type FailedEvent,
  type JobErrorEnvelope,
  type JobObject,
  type JobRequest,
} from '../core/tier2'

export type MockJobState = 'cached' | 'progress' | 'partial' | 'failed' | 'invalid'

export interface Tier2Listener {
  onRunning?: (job: JobObject) => void
  onComplete?: (event: CompleteEvent) => void
  onFailed?: (event: FailedEvent) => void
}

export interface SubmitOptions {
  signal?: AbortSignal
  listener?: Tier2Listener
  /** Mock adapter only. The real adapter always performs one POST. */
  mockState?: MockJobState
}

export interface JobSubmitResult {
  kind: 'job'
  httpStatus: number
  job: JobObject
  /** Present on the mock queued sample. The §11.4 body itself has no queue position. */
  queuePosition: number | null
  /** Set when `job.status` is `failed`. Taken from the `failed` event, not the job object. */
  failure: FailedEvent | null
}

export interface InvalidSubmitResult {
  kind: 'invalid'
  httpStatus: 422
  error: JobErrorEnvelope
}

export interface ErrorSubmitResult {
  kind: 'error'
  httpStatus: number
  error: JobErrorEnvelope
}

export type SubmitResult = JobSubmitResult | InvalidSubmitResult | ErrorSubmitResult

export interface Tier2Client {
  submit(body: JobRequest | typeof INVALID_SIZE_BODY, options?: SubmitOptions): Promise<SubmitResult>
}

export interface Tier2ClientOptions {
  useMocks: boolean
  apiBase: string
  fetchImpl?: typeof fetch
  /** Gap between mock queued, running, and complete. Default 0 in tests via `schedule`. */
  mockDelayMs?: number
  /**
   * Test hook. Called instead of `setTimeout`. The real timer is used when this is omitted.
   * Implementations must not run `fn` before `submit` resolves if the store applies the
   * initial status after the promise.
   */
  schedule?: (fn: () => void, ms: number) => void
}

const EMPTY_ERROR: JobErrorEnvelope = {
  error: { code: 'internal_error', message: '', details: [] },
}

export function resolveMockState(body: unknown, override?: MockJobState): MockJobState {
  if (isInvalidSizeBody(body)) return 'invalid'
  if (override) return override
  if (isExactPresetBody(body, PRESET_WISE_0855)) return 'cached'
  return 'progress'
}

function jobsUrl(apiBase: string): string {
  const base = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase
  return `${base}/api/jobs`
}

function jobResult(
  httpStatus: number,
  job: JobObject,
  queuePosition: number | null,
  failure: FailedEvent | null,
): JobSubmitResult {
  return { kind: 'job', httpStatus, job, queuePosition, failure }
}

function later(options: Tier2ClientOptions, signal: AbortSignal | undefined, fn: () => void, ms: number): void {
  const run = () => {
    if (signal?.aborted) return
    fn()
  }
  if (options.schedule) {
    options.schedule(run, ms)
    return
  }
  const id = setTimeout(run, ms)
  signal?.addEventListener(
    'abort',
    () => {
      clearTimeout(id)
    },
    { once: true },
  )
}

function createMock(options: Tier2ClientOptions): Tier2Client {
  const delay = options.mockDelayMs ?? 0
  return {
    async submit(body, submitOptions) {
      const state = resolveMockState(body, submitOptions?.mockState)
      const signal = submitOptions?.signal
      const listener = submitOptions?.listener
      if (state === 'invalid') {
        return { kind: 'invalid', httpStatus: 422, error: INVALID_SIZE_ERROR }
      }
      if (state === 'cached') {
        return jobResult(200, CACHED_WISE_JOB, null, null)
      }
      if (state === 'failed') {
        // The fixture was captured on GET (HTTP 200, status failed). F15 does not GET.
        // The mock returns that body from submit so callers read `status`, not the HTTP code.
        return jobResult(200, FAILED_FIXTURE_JOB, null, FAILED_FIXTURE_EVENT)
      }
      const terminal = state === 'partial' ? SPEC_PARTIAL_EVENT : SPEC_COMPLETE_EVENT
      later(
        options,
        signal,
        () => {
          listener?.onRunning?.(SPEC_RUNNING_JOB)
          later(
            options,
            signal,
            () => {
              listener?.onComplete?.(terminal)
            },
            delay,
          )
        },
        delay,
      )
      return jobResult(202, SPEC_QUEUED_JOB, 1, null)
    },
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.trim() === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function createReal(options: Tier2ClientOptions): Tier2Client {
  const fetchImpl =
    options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init))
  return {
    async submit(body, submitOptions) {
      const response = await fetchImpl(jobsUrl(options.apiBase), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: submitOptions?.signal,
      })
      const payload = await readJson(response)
      if (isJobObject(payload)) {
        return jobResult(response.status, payload, null, null)
      }
      if (response.status === 422 && isJobErrorEnvelope(payload)) {
        return { kind: 'invalid', httpStatus: 422, error: payload }
      }
      if (isJobErrorEnvelope(payload)) {
        return { kind: 'error', httpStatus: response.status, error: payload }
      }
      if (response.status === 422) {
        return { kind: 'invalid', httpStatus: 422, error: INVALID_SIZE_ERROR }
      }
      return { kind: 'error', httpStatus: response.status, error: EMPTY_ERROR }
    },
  }
}

export function createTier2Client(options: Tier2ClientOptions): Tier2Client {
  return options.useMocks ? createMock(options) : createReal(options)
}
