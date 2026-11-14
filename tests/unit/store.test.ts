import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoadDatasetOptions } from '../../src/data/loader'
import type { Dataset } from '../../src/data/dataset'
import { ContractError } from '../../src/contract/validate'

vi.mock('../../src/data/loader', () => ({
  loadDataset: vi.fn(),
}))

import { loadDataset as fetchDataset } from '../../src/data/loader'
import { useWorkspaceStore } from '../../src/state/store'

const fetchMock = vi.mocked(fetchDataset)

function fake(slug: string, ra = 10, dec = 20): Dataset {
  return {
    meta: {
      slug,
      title: slug,
      center: { ra_deg: ra, dec_deg: dec, t_mid_mjd: 0 },
      status: 'complete',
    },
  } as Dataset
}

interface Pending {
  promise: Promise<Dataset>
  resolve: (dataset: Dataset) => void
  reject: (error: unknown) => void
}

function pending(): Pending {
  let resolve: (dataset: Dataset) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<Dataset>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('workspace store', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    useWorkspaceStore.setState({
      view: { ra: 0, dec: 0, fov: 0.5 },
      tool: { tool: 'blink', frame: { zoom: 4, panX: 3, panY: 2 } },
      dataset: { slug: null, status: 'idle', dataset: null, errorCode: null },
    })
  })

  it('stores a ContractError code and ignores a stale load', async () => {
    const loads: Pending[] = []
    fetchMock.mockImplementation((_slug: string, opts?: LoadDatasetOptions) => {
      const wait = pending()
      const fail = () => wait.reject(new ContractError('invalid', 'dataset request was aborted'))
      if (opts?.signal?.aborted) fail()
      else opts?.signal?.addEventListener('abort', fail)
      loads.push(wait)
      return wait.promise
    })

    const first = useWorkspaceStore.getState().loadDataset('old')
    const second = useWorkspaceStore.getState().loadDataset('new')
    expect(loads[0]).toBeDefined()
    expect(loads[1]).toBeDefined()
    expect(useWorkspaceStore.getState().tool.frame).toEqual({ zoom: 1, panX: 0, panY: 0 })

    loads[1]?.resolve(fake('new', 12, -4))
    await second
    await first

    const ready = useWorkspaceStore.getState()
    expect(ready.dataset.status).toBe('ready')
    expect(ready.dataset.slug).toBe('new')
    expect(ready.dataset.dataset?.meta.slug).toBe('new')
    expect(ready.view.ra).toBe(12)
    expect(ready.view.dec).toBe(-4)
    expect(Object.isFrozen(ready.dataset.dataset)).toBe(true)

    fetchMock.mockRejectedValueOnce(new ContractError('not_found', 'missing'))
    await useWorkspaceStore.getState().loadDataset('missing')
    expect(useWorkspaceStore.getState().dataset.status).toBe('error')
    expect(useWorkspaceStore.getState().dataset.errorCode).toBe('not_found')
  })
})
