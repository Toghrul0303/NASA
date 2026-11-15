import { beforeEach, describe, expect, it, vi } from 'vitest'
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
} from '../../src/core/tier2'
import type { Tier2Listener } from '../../src/api/tier2Client'

const submit = vi.hoisted(() => vi.fn())
const fetchDataset = vi.hoisted(() => vi.fn())

vi.mock('../../src/api/tier2Client', () => ({
  createTier2Client: () => ({ submit }),
}))

vi.mock('../../src/data/loader', () => ({
  loadDataset: (...args: unknown[]) => fetchDataset(...args),
}))

import { useWorkspaceStore } from '../../src/state/store'

describe('tier2 store', () => {
  beforeEach(() => {
    submit.mockReset()
    fetchDataset.mockReset()
    fetchDataset.mockImplementation(() => new Promise(() => {}))
    useWorkspaceStore.setState((state) => ({
      dataset: { slug: 'barnards-star', status: 'ready', dataset: state.dataset.dataset, errorCode: null },
      job: {
        status: 'idle',
        partial: false,
        cached: false,
        joined: false,
        queuePosition: null,
        nFailedFetches: 0,
        jobId: null,
        slug: null,
        request: null,
        failure: null,
        fieldErrors: [],
        errorCode: null,
        errorMessage: null,
        navigation: null,
      },
    }))
  })

  it('opens a cached complete dataset without queued or running', async () => {
    const seen: string[] = []
    const unsubscribe = useWorkspaceStore.subscribe((state) => {
      seen.push(state.job.status)
    })
    submit.mockResolvedValue({
      kind: 'job',
      httpStatus: 200,
      job: CACHED_WISE_JOB,
      queuePosition: null,
      failure: null,
    })
    await useWorkspaceStore.getState().submitTier2(PRESET_WISE_0855)
    unsubscribe()
    const job = useWorkspaceStore.getState().job
    expect(seen).not.toContain('queued')
    expect(seen).not.toContain('running')
    expect(job.status).toBe('complete')
    expect(job.cached).toBe(true)
    expect(job.partial).toBe(false)
    expect(job.navigation?.slug).toBe('c-a55d19970b4b8fd7')
    expect(fetchDataset.mock.calls[0]?.[0]).toBe('c-a55d19970b4b8fd7')
  })

  it('moves from queued to running to complete', async () => {
    let listener: Tier2Listener | undefined
    submit.mockImplementation(async (_body: unknown, options?: { listener?: Tier2Listener }) => {
      listener = options?.listener
      return { kind: 'job', httpStatus: 202, job: SPEC_QUEUED_JOB, queuePosition: 1, failure: null }
    })
    await useWorkspaceStore.getState().submitTier2({ ra_deg: 10, dec_deg: 20, size_deg: 0.1 })
    expect(useWorkspaceStore.getState().job.status).toBe('queued')
    expect(useWorkspaceStore.getState().job.queuePosition).toBe(1)
    expect(fetchDataset).not.toHaveBeenCalled()
    listener?.onRunning?.(SPEC_RUNNING_JOB)
    expect(useWorkspaceStore.getState().job.status).toBe('running')
    listener?.onComplete?.(SPEC_COMPLETE_EVENT)
    expect(useWorkspaceStore.getState().job.status).toBe('complete')
    expect(useWorkspaceStore.getState().job.partial).toBe(false)
    expect(fetchDataset.mock.calls[0]?.[0]).toBe(SPEC_COMPLETE_EVENT.slug)
  })

  it('sets the partial flag from result_status and still opens the slug', async () => {
    let listener: Tier2Listener | undefined
    submit.mockImplementation(async (_body: unknown, options?: { listener?: Tier2Listener }) => {
      listener = options?.listener
      return { kind: 'job', httpStatus: 202, job: SPEC_QUEUED_JOB, queuePosition: 1, failure: null }
    })
    await useWorkspaceStore.getState().submitTier2({ ra_deg: 10, dec_deg: 20, size_deg: 0.2 })
    listener?.onComplete?.(SPEC_PARTIAL_EVENT)
    const job = useWorkspaceStore.getState().job
    expect(job.status).toBe('complete')
    expect(job.partial).toBe(true)
    expect(job.nFailedFetches).toBe(1)
    expect(fetchDataset.mock.calls[0]?.[0]).toBe(SPEC_PARTIAL_EVENT.slug)
  })

  it('keeps the current dataset when the job fails', async () => {
    submit.mockResolvedValue({
      kind: 'job',
      httpStatus: 200,
      job: FAILED_FIXTURE_JOB,
      queuePosition: null,
      failure: FAILED_FIXTURE_EVENT,
    })
    await useWorkspaceStore.getState().submitTier2(PRESET_WISE_0855)
    const state = useWorkspaceStore.getState()
    expect(state.job.status).toBe('failed')
    expect(state.job.failure).toEqual({
      code: 'upstream_unavailable',
      message: 'Fixture: IRSA was not called.',
      retryable: true,
    })
    expect(state.job.navigation).toBeNull()
    expect(state.dataset.slug).toBe('barnards-star')
    expect(state.dataset.status).toBe('ready')
    expect(fetchDataset).not.toHaveBeenCalled()
  })

  it('shows 422 field details and does not open a dataset', async () => {
    submit.mockResolvedValue({ kind: 'invalid', httpStatus: 422, error: INVALID_SIZE_ERROR })
    await useWorkspaceStore.getState().submitTier2(INVALID_SIZE_BODY)
    const job = useWorkspaceStore.getState().job
    expect(job.status).toBe('idle')
    expect(job.errorCode).toBe('invalid_request')
    expect(job.fieldErrors).toEqual([{ field: 'size_deg', issue: 'must be one of 0.05, 0.1, 0.2' }])
    expect(fetchDataset).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().dataset.slug).toBe('barnards-star')
  })
})
