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
    frames: {
      frames: [{ index: 0, detector: 1, lambda_um: 1.25, bandwidth_um: 0.05 }],
      epochs: [{ epoch_id: 0, detectors: [1] }],
    },
    coadds: { coadds: [] },
  } as unknown as Dataset
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
    useWorkspaceStore.setState((state) => ({
      view: { ra: 0, dec: 0, fov: 0.5 },
      tool: { ...state.tool, tool: 'blink', frame: { zoom: 4, panX: 3, panY: 2 } },
      dataset: { slug: null, status: 'idle', dataset: null, errorCode: null },
    }))
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

  it('resets blink from the dataset and can open one frame in the set', async () => {
    const withFrames = fake('barnard')
    withFrames.frames.frames = [
      { index: 0, detector: 1, lambda_um: 1, bandwidth_um: 0.1 },
      { index: 1, detector: 2, lambda_um: 1, bandwidth_um: 0.1 },
      { index: 2, detector: 2, lambda_um: 1, bandwidth_um: 0.1 },
      { index: 3, detector: 2, lambda_um: 5, bandwidth_um: 0.1 },
    ] as Dataset['frames']['frames']
    fetchMock.mockResolvedValueOnce(withFrames)

    await useWorkspaceStore.getState().loadDataset('barnard')
    const ready = useWorkspaceStore.getState().tool.blink
    expect(ready.detector).toBe(2)
    expect(ready.lambda0).toBe(1)
    expect(ready.k).toBe(1)
    expect(ready.itemIndex).toBe(0)
    expect(ready.playing).toBe(false)
    expect(ready.loop).toBe(true)
    expect(ready.spacing).toBe('frame')
    expect(ready.overlays).toEqual({
      predicted: true,
      apertures: true,
      annulus: false,
      centroid: true,
      trail: false,
    })

    useWorkspaceStore.getState().setBlink({ k: 9, fps: 40, itemIndex: 5, overlays: { trail: true } })
    const patched = useWorkspaceStore.getState().tool.blink
    expect(patched.k).toBe(3)
    expect(patched.fps).toBe(10)
    expect(patched.itemIndex).toBe(1)
    expect(patched.overlays.trail).toBe(true)
    expect(patched.overlays.predicted).toBe(true)

    useWorkspaceStore.getState().setBlink({ loop: false })
    useWorkspaceStore.getState().stepBlink(1)
    expect(useWorkspaceStore.getState().tool.blink.itemIndex).toBe(1)
    useWorkspaceStore.getState().setBlink({ loop: true })
    useWorkspaceStore.getState().stepBlink(1)
    expect(useWorkspaceStore.getState().tool.blink.itemIndex).toBe(0)

    useWorkspaceStore.getState().openFrameInBlink(3)
    const opened = useWorkspaceStore.getState()
    expect(opened.tool.tool).toBe('blink')
    expect(opened.tool.blink.mode).toBe('frames')
    expect(opened.tool.blink.detector).toBe(2)
    expect(opened.tool.blink.lambda0).toBe(5)
    expect(opened.tool.blink.itemIndex).toBe(0)
  })
})
