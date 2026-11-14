import { describe, expect, it } from 'vitest'
import type { Coadd, Detector, Epoch, Frame } from '../../src/contract/types'
import {
  blinkLimits,
  defaultDetector,
  defaultLambda0,
  enabledDetectors,
  inWindow,
  lambdaHistogram,
  selectEpochCoadds,
  selectFrames,
  setKey,
} from '../../src/core/blink'
import { epochLabel, epochSpans } from '../../src/core/epochs'

function frame(overrides: Pick<Frame, 'detector' | 'lambda_um' | 'bandwidth_um'> & Partial<Frame>): Frame {
  return {
    index: overrides.index ?? 0,
    frame_key: overrides.frame_key ?? 'frame',
    obs_id: overrides.obs_id ?? 'OBS',
    release: overrides.release ?? 'dr1',
    processing_version: overrides.processing_version ?? null,
    detector: overrides.detector,
    mjd: overrides.mjd ?? 60400,
    obs_time_utc: overrides.obs_time_utc ?? '2024-03-31T00:00:00.000Z',
    epoch_id: overrides.epoch_id ?? 0,
    lambda_um: overrides.lambda_um,
    bandwidth_um: overrides.bandwidth_um,
    lambda_min_um: overrides.lambda_min_um ?? overrides.lambda_um,
    lambda_max_um: overrides.lambda_max_um ?? overrides.lambda_um,
    channel: overrides.channel ?? 0,
    target_ra_deg: overrides.target_ra_deg ?? 10,
    target_dec_deg: overrides.target_dec_deg ?? 0,
    target_x: overrides.target_x ?? 0,
    target_y: overrides.target_y ?? 0,
    good_fraction: overrides.good_fraction ?? 1,
    aperture_pixels: overrides.aperture_pixels ?? 1,
    flag_fractions: overrides.flag_fractions ?? null,
    contamination_level: overrides.contamination_level ?? 0,
    saturated_pixels: overrides.saturated_pixels ?? 0,
    alignment_residual_px: overrides.alignment_residual_px ?? null,
    source_uri: overrides.source_uri ?? 'https://example.test/cutout',
  }
}

function epoch(epochId: number, detectors: Detector[]): Epoch {
  return {
    epoch_id: epochId,
    mjd_start: 60400,
    mjd_end: 60401,
    mjd_mean: 60400.5,
    n_frames: 1,
    detectors,
  }
}

function coadd(overrides: Pick<Coadd, 'scope' | 'detector' | 'epoch_id'> & Partial<Coadd>): Coadd {
  return {
    index: overrides.index ?? 0,
    scope: overrides.scope,
    epoch_id: overrides.epoch_id,
    detector: overrides.detector,
    channel: overrides.channel ?? null,
    n_frames: overrides.n_frames ?? 1,
    frame_indices: overrides.frame_indices ?? [0],
    mjd_min: overrides.mjd_min ?? 60400,
    mjd_max: overrides.mjd_max ?? 60401,
    mjd_mean: overrides.mjd_mean ?? 60400.5,
    lambda_mean_um: overrides.lambda_mean_um ?? 1,
    lambda_min_um: overrides.lambda_min_um ?? 0.9,
    lambda_max_um: overrides.lambda_max_um ?? 1.1,
    snr_target: overrides.snr_target ?? null,
  }
}

describe('defaultDetector', () => {
  it('breaks a tie toward the lower detector number', () => {
    const frames = [
      frame({ index: 0, detector: 4, lambda_um: 2, bandwidth_um: 0.1 }),
      frame({ index: 1, detector: 4, lambda_um: 2, bandwidth_um: 0.1 }),
      frame({ index: 2, detector: 2, lambda_um: 1, bandwidth_um: 0.1 }),
      frame({ index: 3, detector: 2, lambda_um: 1, bandwidth_um: 0.1 }),
      frame({ index: 4, detector: 6, lambda_um: 3, bandwidth_um: 0.1 }),
    ]
    expect(defaultDetector(frames)).toBe(2)
    expect(
      defaultDetector([
        frame({ detector: 1, lambda_um: 1, bandwidth_um: 0.1 }),
        frame({ detector: 5, lambda_um: 2, bandwidth_um: 0.1 }),
        frame({ detector: 5, lambda_um: 2, bandwidth_um: 0.1 }),
      ]),
    ).toBe(5)
  })
})

describe('inWindow', () => {
  it('includes a frame exactly k bandwidths from the centre', () => {
    const sample = frame({ detector: 1, lambda_um: 1, bandwidth_um: 0.25 })
    expect(inWindow(sample, 1.5, 2)).toBe(true)
    expect(inWindow(sample, 0.5, 2)).toBe(true)
    expect(inWindow(sample, 1.5 + 1e-6, 2)).toBe(false)
    expect(inWindow(sample, 0.5 - 1e-6, 2)).toBe(false)
  })
})

describe('defaultLambda0', () => {
  it('picks the wavelength with the largest in-window count and breaks ties to the lower wavelength', () => {
    const tied = [
      frame({ index: 0, detector: 1, lambda_um: 4, bandwidth_um: 0.1 }),
      frame({ index: 1, detector: 1, lambda_um: 4, bandwidth_um: 0.1 }),
      frame({ index: 2, detector: 1, lambda_um: 1.5, bandwidth_um: 0.1 }),
      frame({ index: 3, detector: 1, lambda_um: 1.5, bandwidth_um: 0.1 }),
    ]
    expect(defaultLambda0(tied, 1, 1)).toBe(1.5)

    const widerCentre = [
      frame({ index: 0, detector: 1, lambda_um: 1, bandwidth_um: 0.1 }),
      frame({ index: 1, detector: 1, lambda_um: 2, bandwidth_um: 1.5 }),
      frame({ index: 2, detector: 1, lambda_um: 2, bandwidth_um: 1.5 }),
    ]
    expect(defaultLambda0(widerCentre, 1, 1)).toBe(1)

    const crowded = [
      frame({ index: 0, detector: 3, lambda_um: 1, bandwidth_um: 0.1 }),
      frame({ index: 1, detector: 3, lambda_um: 3, bandwidth_um: 0.1 }),
      frame({ index: 2, detector: 3, lambda_um: 3, bandwidth_um: 0.1 }),
      frame({ index: 3, detector: 3, lambda_um: 3, bandwidth_um: 0.1 }),
    ]
    expect(defaultLambda0(crowded, 3, 1)).toBe(3)
    expect(defaultLambda0([], 1)).toBeNaN()
  })
})

describe('selectFrames', () => {
  it('keeps frames.json order and does not sort by time', () => {
    const frames = [
      frame({ index: 0, detector: 2, lambda_um: 1, bandwidth_um: 0.2, mjd: 9 }),
      frame({ index: 1, detector: 1, lambda_um: 5, bandwidth_um: 0.2, mjd: 1 }),
      frame({ index: 2, detector: 1, lambda_um: 1.1, bandwidth_um: 0.2, mjd: 8 }),
      frame({ index: 3, detector: 1, lambda_um: 1.1, bandwidth_um: 0.2, mjd: 2 }),
    ]
    expect(selectFrames(frames, 1, 1, 1).map((entry) => entry.index)).toEqual([2, 3])
  })
})

describe('enabledDetectors', () => {
  it('reads the union of epochs[*].detectors', () => {
    expect(
      enabledDetectors([
        epoch(0, [6, 2]),
        epoch(1, [2, 4]),
      ]),
    ).toEqual([2, 4, 6])
    expect(enabledDetectors([epoch(0, [1])])).not.toContain(3)
  })
})

describe('epoch coadds, histogram, limits, and the set key', () => {
  it('orders epoch_detector coadds by epoch_id and ignores other scopes', () => {
    const coadds = [
      coadd({ index: 0, scope: 'detector', detector: 1, epoch_id: null }),
      coadd({ index: 1, scope: 'epoch_detector', detector: 1, epoch_id: 2 }),
      coadd({ index: 2, scope: 'epoch_detector', detector: 2, epoch_id: 0 }),
      coadd({ index: 3, scope: 'epoch_detector', detector: 1, epoch_id: 0 }),
      coadd({ index: 4, scope: 'channel', detector: 1, epoch_id: null, channel: 4 }),
    ]
    expect(selectEpochCoadds(coadds, 1).map((entry) => entry.index)).toEqual([3, 1])
  })

  it('counts lambda_um in equal-width bins and reuses stretch limits', () => {
    const frames = [
      frame({ detector: 1, lambda_um: 1, bandwidth_um: 0.1 }),
      frame({ detector: 1, lambda_um: 1, bandwidth_um: 0.1 }),
      frame({ detector: 1, lambda_um: 1.5, bandwidth_um: 0.1 }),
      frame({ detector: 2, lambda_um: 9, bandwidth_um: 0.1 }),
    ]
    const bins = lambdaHistogram(frames, 1, 2)
    expect(bins).toHaveLength(2)
    expect(bins[0]).toMatchObject({ x0: 1, count: 2 })
    expect(bins[1]).toMatchObject({ x1: 1.5, count: 1 })
    expect(lambdaHistogram(frames, 4, 4)).toEqual([])

    expect(blinkLimits([new Float32Array([1, Number.NaN]), new Float32Array([3])], 0, 100)).toEqual({
      lo: 1,
      hi: 3,
    })
    expect(setKey('frames', 2, 1.5, 1)).toBe('frames:2:1.5:1')
    expect(setKey('epochs', 2, 1.5, 1)).toBe('epochs:2:1.5:1')
  })
})

describe('epoch spans', () => {
  it('labels epochs and splits runs where consecutive ids differ', () => {
    expect(epochLabel(0)).toBe('E0')
    expect(epochLabel(12)).toBe('E12')
    expect(epochSpans([0, 0, 1, 2, 2])).toEqual([
      { epoch_id: 0, start: 0, end: 2 },
      { epoch_id: 1, start: 2, end: 3 },
      { epoch_id: 2, start: 3, end: 5 },
    ])
  })
})
