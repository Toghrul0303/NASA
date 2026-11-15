import { describe, expect, it, vi } from 'vitest'
import { createTier2Client, resolveMockState, type MockJobState } from '../../src/api/tier2Client'
import {
  CACHED_WISE_JOB,
  FAILED_FIXTURE_EVENT,
  KNOWN_DATASET_SLUGS,
  isKnownDatasetSlug,
  FAILED_FIXTURE_JOB,
  INVALID_SIZE_BODY,
  INVALID_SIZE_ERROR,
  PRESET_EPSILON,
  PRESET_PROXIMA,
  PRESET_WISE_0855,
  SAFE_TIER2_PRESET,
  SPEC_COMPLETE_EVENT,
  SPEC_PARTIAL_EVENT,
  SPEC_QUEUED_JOB,
  SPEC_RUNNING_JOB,
  TIER2_PRESETS,
  buildJobRequest,
  datasetSlugForJob,
  isCompleteEvent,
  isExactPresetBody,
  isFailedEvent,
  isInvalidSizeBody,
  isJobErrorEnvelope,
  isJobObject,
  isJobStatus,
  isResultStatus,
  isSizeDeg,
  type CompleteEvent,
  type JobObject,
  type JobRequest,
} from '../../src/core/tier2'

function timers() {
  const queue: Array<{ ms: number; fn: () => void }> = []
  return {
    queue,
    schedule(fn: () => void, ms: number) {
      queue.push({ ms, fn })
    },
    next() {
      const item = queue.shift()
      item?.fn()
    },
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('buildJobRequest', () => {
  it('copies coordinates and size through without rounding or defaulting', () => {
    const body = buildJobRequest(1.234567891, -0.0000004, 0.05)
    expect(body.ra_deg).toBe(1.234567891)
    expect(body.dec_deg).toBe(-0.0000004)
    expect(body.size_deg).toBe(0.05)
    expect(body).toEqual({ ra_deg: 1.234567891, dec_deg: -0.0000004, size_deg: 0.05 })
  })

  it('does not coerce a proper-motion integer and omits options that were not passed', () => {
    const body = buildJobRequest(133.795129, -7.245147, 0.1, { pmraMasYr: -8120, pmdecMasYr: 679 })
    expect(Object.is(body.pmra_mas_yr, -8120)).toBe(true)
    expect(body.pmdec_mas_yr).toBe(679)
    expect('name' in body).toBe(false)
    expect('coord_epoch_year' in body).toBe(false)
    expect('coord_epoch_assumed' in body).toBe(false)
    expect('force_refresh' in body).toBe(false)
  })

  it('keeps explicit nulls and a boolean the caller set', () => {
    const body = buildJobRequest(400, 91, 0.2, {
      name: null,
      pmraMasYr: null,
      pmdecMasYr: null,
      coordEpochYear: null,
      forceRefresh: false,
    })
    expect(body.ra_deg).toBe(400)
    expect(body.dec_deg).toBe(91)
    expect(body).toEqual({
      ra_deg: 400,
      dec_deg: 91,
      size_deg: 0.2,
      name: null,
      pmra_mas_yr: null,
      pmdec_mas_yr: null,
      coord_epoch_year: null,
      force_refresh: false,
    })
  })

  it('matches the three preset bodies and marks only WISE safe', () => {
    expect(TIER2_PRESETS.map((preset) => preset.body)).toEqual([PRESET_WISE_0855, PRESET_PROXIMA, PRESET_EPSILON])
    expect(SAFE_TIER2_PRESET.id).toBe('wise-0855')
    expect(SAFE_TIER2_PRESET.safe).toBe(true)
    expect(SAFE_TIER2_PRESET.slug).toBe('c-a55d19970b4b8fd7')
    expect(TIER2_PRESETS.filter((preset) => !preset.safe).map((preset) => preset.slug)).toEqual([
      'c-843ee254e3d6b9be',
      'c-c8a384476c0ae479',
    ])
    expect(PRESET_WISE_0855).toEqual({
      ra_deg: 133.795129,
      dec_deg: -7.245147,
      size_deg: 0.1,
      name: 'WISE 0855 coord',
      pmra_mas_yr: -8120,
      pmdec_mas_yr: 679,
    })
    expect('pmra_mas_yr' in PRESET_PROXIMA).toBe(false)
    expect('pmra_mas_yr' in PRESET_EPSILON).toBe(false)
  })
})

describe('tier2 type guards', () => {
  it('accepts the job status names including failed and rejects partial', () => {
    expect(isJobStatus('queued')).toBe(true)
    expect(isJobStatus('running')).toBe(true)
    expect(isJobStatus('complete')).toBe(true)
    expect(isJobStatus('failed')).toBe(true)
    expect(isJobStatus('partial')).toBe(false)
    expect(isResultStatus('partial')).toBe(true)
    expect(isResultStatus('complete')).toBe(true)
    expect(isResultStatus('failed')).toBe(false)
  })

  it('accepts only the three grid sizes', () => {
    expect(isSizeDeg(0.05)).toBe(true)
    expect(isSizeDeg(0.1)).toBe(true)
    expect(isSizeDeg(0.2)).toBe(true)
    expect(isSizeDeg(0.3)).toBe(false)
    expect(isSizeDeg('0.1')).toBe(false)
  })

  it('accepts the captured job objects and the uncaptured queued example', () => {
    expect(isJobObject(CACHED_WISE_JOB)).toBe(true)
    expect(isJobObject(FAILED_FIXTURE_JOB)).toBe(true)
    expect(isJobObject(SPEC_QUEUED_JOB)).toBe(true)
    expect(isJobObject(SPEC_RUNNING_JOB)).toBe(true)
    expect(datasetSlugForJob(CACHED_WISE_JOB)).toBe('c-a55d19970b4b8fd7')
    expect(CACHED_WISE_JOB.data_base_url).toBe('/data/c-a55d19970b4b8fd7/')
    const partialStatus: Record<string, unknown> = { ...SPEC_QUEUED_JOB, status: 'partial' }
    expect(isJobObject(partialStatus)).toBe(false)
  })

  it('accepts the 422 envelope and the complete events, and rejects a job as an error', () => {
    expect(isJobErrorEnvelope(INVALID_SIZE_ERROR)).toBe(true)
    expect(isJobErrorEnvelope(CACHED_WISE_JOB)).toBe(false)
    expect(INVALID_SIZE_ERROR.error.details[0]).toEqual({
      field: 'size_deg',
      issue: 'must be one of 0.05, 0.1, 0.2',
    })
    expect(isCompleteEvent(SPEC_COMPLETE_EVENT)).toBe(true)
    expect(isCompleteEvent(SPEC_PARTIAL_EVENT)).toBe(true)
    expect(SPEC_PARTIAL_EVENT.result_status).toBe('partial')
    expect(isFailedEvent(FAILED_FIXTURE_EVENT)).toBe(true)
    expect(isInvalidSizeBody(INVALID_SIZE_BODY)).toBe(true)
    expect(isExactPresetBody(PRESET_WISE_0855, PRESET_WISE_0855)).toBe(true)
  })
})

describe('mock tier2 client', () => {
  function mockClient(delayMs = 40) {
    const clock = timers()
    const fetchImpl = vi.fn<typeof fetch>()
    const client = createTier2Client({
      useMocks: true,
      apiBase: 'http://localhost:8000',
      fetchImpl,
      mockDelayMs: delayMs,
      schedule: clock.schedule,
    })
    return { client, clock, fetchImpl }
  }

  it('returns the captured cached job for the safe preset', async () => {
    const { client, clock, fetchImpl } = mockClient()
    const result = await client.submit(PRESET_WISE_0855)
    expect(result).toEqual({
      kind: 'job',
      httpStatus: 200,
      job: CACHED_WISE_JOB,
      queuePosition: null,
      failure: null,
    })
    expect(clock.queue).toHaveLength(0)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(resolveMockState(PRESET_WISE_0855)).toBe('cached')
  })

  it('walks queued, then running, then complete for a new job', async () => {
    const { client, clock, fetchImpl } = mockClient()
    const running: JobObject[] = []
    const done: CompleteEvent[] = []
    const result = await client.submit(PRESET_PROXIMA, {
      listener: {
        onRunning: (job) => running.push(job),
        onComplete: (event) => done.push(event),
      },
    })
    expect(result.kind).toBe('job')
    if (result.kind !== 'job') return
    expect(result.httpStatus).toBe(202)
    expect(result.job).toBe(SPEC_QUEUED_JOB)
    expect(result.job.status).toBe('queued')
    expect(result.queuePosition).toBe(1)
    expect(running).toHaveLength(0)
    clock.next()
    expect(running.map((job) => job.status)).toEqual(['running'])
    expect(done).toHaveLength(0)
    clock.next()
    expect(done).toEqual([SPEC_COMPLETE_EVENT])
    expect(done[0]?.result_status).toBe('complete')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('ends a partial run on result_status partial', async () => {
    const { client, clock } = mockClient()
    const done: CompleteEvent[] = []
    const result = await client.submit(PRESET_EPSILON, {
      mockState: 'partial',
      listener: { onComplete: (event) => done.push(event) },
    })
    expect(result.kind).toBe('job')
    if (result.kind !== 'job') return
    expect(result.httpStatus).toBe(202)
    expect(result.job.status).toBe('queued')
    clock.next()
    clock.next()
    expect(done[0]).toBe(SPEC_PARTIAL_EVENT)
    expect(done[0]?.result_status).toBe('partial')
    expect(done[0]?.n_failed_fetches).toBe(1)
  })

  it('returns the failed fixture as HTTP 200 and reads status failed', async () => {
    const { client, fetchImpl } = mockClient()
    const result = await client.submit(PRESET_PROXIMA, { mockState: 'failed' })
    expect(result).toEqual({
      kind: 'job',
      httpStatus: 200,
      job: FAILED_FIXTURE_JOB,
      queuePosition: null,
      failure: FAILED_FIXTURE_EVENT,
    })
    if (result.kind !== 'job') return
    expect(result.job.status).toBe('failed')
    expect(result.failure?.code).toBe('upstream_unavailable')
    expect(result.failure?.message).toBe('Fixture: IRSA was not called.')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('opens only known dataset slugs when a mock job completes', async () => {
    const { client, clock } = mockClient()
    const slugs: string[] = []

    const cached = await client.submit(PRESET_WISE_0855)
    if (cached.kind === 'job') slugs.push(cached.job.slug)

    const progressDone: CompleteEvent[] = []
    await client.submit(PRESET_PROXIMA, {
      mockState: 'progress',
      listener: { onComplete: (event) => progressDone.push(event) },
    })
    clock.next()
    clock.next()
    const progressSlug = progressDone[0]?.slug
    if (progressSlug) slugs.push(progressSlug)

    const partialDone: CompleteEvent[] = []
    await client.submit(PRESET_EPSILON, {
      mockState: 'partial',
      listener: { onComplete: (event) => partialDone.push(event) },
    })
    clock.next()
    clock.next()
    const partialSlug = partialDone[0]?.slug
    if (partialSlug) slugs.push(partialSlug)

    expect(slugs).toEqual(['c-a55d19970b4b8fd7', 'c-a55d19970b4b8fd7', 'fixture-barnard'])
    for (const slug of slugs) {
      expect(KNOWN_DATASET_SLUGS).toContain(slug)
      expect(isKnownDatasetSlug(slug)).toBe(true)
      expect(slug).not.toBe('c-8e21b4d0a97c3f56')
    }
  })

  it('returns the captured 422 envelope for an invalid size', async () => {
    const { client, fetchImpl } = mockClient()
    const result = await client.submit(INVALID_SIZE_BODY)
    expect(result).toEqual({ kind: 'invalid', httpStatus: 422, error: INVALID_SIZE_ERROR })
    expect(fetchImpl).not.toHaveBeenCalled()
    const states: MockJobState[] = ['cached', 'progress', 'partial', 'failed', 'invalid']
    for (const state of states) {
      expect(resolveMockState(INVALID_SIZE_BODY, state)).toBe('invalid')
    }
  })
})

describe('real tier2 client', () => {
  it('posts once and treats HTTP 200 with status failed as failed', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(FAILED_FIXTURE_JOB, 200))
    const client = createTier2Client({ useMocks: false, apiBase: 'http://localhost:8000/', fetchImpl })
    const listener = { onRunning: vi.fn(), onComplete: vi.fn() }
    const result = await client.submit(PRESET_WISE_0855, { listener })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:8000/api/jobs')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init?.body))).toEqual(PRESET_WISE_0855)
    expect(result.kind).toBe('job')
    if (result.kind !== 'job') return
    expect(result.httpStatus).toBe(200)
    expect(result.job.status).toBe('failed')
    expect(listener.onRunning).not.toHaveBeenCalled()
    expect(listener.onComplete).not.toHaveBeenCalled()
  })

  it('returns a cached complete job from HTTP 200 without a second request', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(CACHED_WISE_JOB, 200))
    const client = createTier2Client({ useMocks: false, apiBase: '', fetchImpl })
    const result = await client.submit(PRESET_WISE_0855)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/jobs')
    expect(result).toMatchObject({
      kind: 'job',
      httpStatus: 200,
      job: { status: 'complete', cached: true, slug: 'c-a55d19970b4b8fd7' },
    })
  })

  it('returns a queued job from HTTP 202 and does not poll', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(SPEC_QUEUED_JOB, 202))
    const client = createTier2Client({ useMocks: false, apiBase: '', fetchImpl })
    const result = await client.submit({ ra_deg: 10, dec_deg: 20, size_deg: 0.1 } satisfies JobRequest)
    expect(result).toMatchObject({ kind: 'job', httpStatus: 202, job: { status: 'queued' } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('returns field details for HTTP 422', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(INVALID_SIZE_ERROR, 422))
    const client = createTier2Client({ useMocks: false, apiBase: '', fetchImpl })
    const result = await client.submit(INVALID_SIZE_BODY)
    expect(result.kind).toBe('invalid')
    if (result.kind !== 'invalid') return
    expect(result.httpStatus).toBe(422)
    expect(result.error.error.code).toBe('invalid_request')
    expect(result.error.error.details).toEqual([{ field: 'size_deg', issue: 'must be one of 0.05, 0.1, 0.2' }])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
