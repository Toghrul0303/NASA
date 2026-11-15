import { describe, expect, it } from 'vitest'
import type { Coadd, RgbPresets } from '../../src/contract/types'
import { ASINH_SOFTENING } from '../../src/config/constants'
import { combineInverseVariance, composeRgb, selectMembers, type RgbGains } from '../../src/core/rgb'
import type { StretchLimits } from '../../src/core/stretch'

const MASK = [9, 8, 7] as const

function coadd(partial: Pick<Coadd, 'index' | 'scope'> & Partial<Coadd>): Coadd {
  return {
    epoch_id: null,
    detector: null,
    channel: null,
    n_frames: 1,
    frame_indices: [0],
    mjd_min: 0,
    mjd_max: 0,
    mjd_mean: 0,
    lambda_mean_um: 1,
    lambda_min_um: 1,
    lambda_max_um: 1,
    snr_target: null,
    ...partial,
  }
}

const presets: RgbPresets = {
  detector_rgb: {
    blue: [1, 6],
    green: [2],
    red: [3],
    group_snr: { blue: 1, green: 2, red: 3 },
    min_group_snr: 1,
  },
  equal_channel_rgb: {
    blue_channels: [0, 5, 7],
    green_channels: [10],
    red_channels: [20],
  },
  feature_lines: [],
}

const coadds: Coadd[] = [
  coadd({ index: 0, scope: 'channel', channel: 20, detector: 2 }),
  coadd({ index: 1, scope: 'detector', detector: 3 }),
  coadd({ index: 2, scope: 'detector', detector: 1 }),
  coadd({ index: 3, scope: 'epoch_detector', epoch_id: 0, detector: 2 }),
  coadd({ index: 4, scope: 'detector', detector: 2 }),
  coadd({ index: 5, scope: 'detector', detector: 4 }),
  coadd({ index: 6, scope: 'channel', channel: 99 }),
  coadd({ index: 7, scope: 'channel', channel: 0 }),
  coadd({ index: 8, scope: 'channel', channel: 10 }),
  coadd({ index: 9, scope: 'channel', channel: 5 }),
]

function limits(lo: number, hi: number): StretchLimits {
  return { lo, hi }
}

function gains(red: number, green = 1, blue = 1): RgbGains {
  return { red, green, blue }
}

function stretched(value: number, lo: number, hi: number, gain: number): number {
  const t = Math.min(1, Math.max(0, (value - lo) / (hi - lo)))
  const s = Math.asinh(t / ASINH_SOFTENING) / Math.asinh(1 / ASINH_SOFTENING)
  return Math.round(255 * Math.min(1, Math.max(0, s * gain)))
}

describe('combineInverseVariance', () => {
  it('returns the inverse-variance mean and 1/sum(w), and NaN when nothing qualifies', () => {
    // Pixel 0: equal weights. I = (1*2 + 1*6) / 2 = 4, V = 1/2.
    // Pixel 1: w = 1/0.5^2 = 4 and w = 1. I = (4*4 + 1*8) / 5 = 4.8, V = 1/5.
    // Pixel 2: the NaN sample is skipped. w = 1/2^2 = 1/4, I = 6, V = 4.
    // Pixel 3: sigma 0 and sigma -1. Neither qualifies.
    // Pixel 4: both intensities are NaN.
    const I1 = new Float32Array([2, 4, Number.NaN, 9, Number.NaN])
    const s1 = new Float32Array([1, 0.5, 1, 0, 1])
    const I2 = new Float32Array([6, 8, 6, 5, Number.NaN])
    const s2 = new Float32Array([1, 1, 2, -1, 1])
    const combined = combineInverseVariance([
      { I: I1, sigma: s1 },
      { I: I2, sigma: s2 },
    ])
    expect(combined.I[0]).toBe(4)
    expect(combined.V[0]).toBe(0.5)
    expect(combined.I[1]).toBeCloseTo(4.8, 5)
    expect(combined.V[1]).toBeCloseTo(0.2, 5)
    expect(combined.I[2]).toBe(6)
    expect(combined.V[2]).toBe(4)
    expect(combined.I[3]).toBeNaN()
    expect(combined.V[3]).toBeNaN()
    expect(combined.I[4]).toBeNaN()
    expect(combined.V[4]).toBeNaN()
  })
})

describe('selectMembers', () => {
  it('keeps coadds order and skips detectors or channels the preset names that are absent', () => {
    expect(selectMembers('detector', coadds, presets)).toEqual({ blue: [2], green: [4], red: [1] })
    expect(selectMembers('equal_channel', coadds, presets)).toEqual({ blue: [7, 9], green: [8], red: [0] })
    expect(selectMembers('detector', coadds, { ...presets, detector_rgb: null })).toEqual({
      blue: [],
      green: [],
      red: [],
    })
  })
})

describe('composeRgb', () => {
  it('clamps gain at 2, paints an all-NaN pixel with the mask, and links min lo with max hi', () => {
    const mid = new Float32Array([0.05])
    const zero = new Float32Array([0])
    const unit = [limits(0, 1), limits(0, 1), limits(0, 1)] as const
    const atTwo = composeRgb(
      { slots: [mid, zero, zero], limits: unit, linked: false, gains: gains(2), a: ASINH_SOFTENING, maskRGB: MASK },
      1,
      1,
    )
    const aboveTwo = composeRgb(
      { slots: [mid, zero, zero], limits: unit, linked: false, gains: gains(4), a: ASINH_SOFTENING, maskRGB: MASK },
      1,
      1,
    )
    expect(aboveTwo[0]).toBe(atTwo[0])
    expect(aboveTwo[0]).toBe(stretched(0.05, 0, 1, 2))
    expect(stretched(0.05, 0, 1, 2)).not.toBe(stretched(0.05, 0, 1, 4))

    const nan = new Float32Array([Number.NaN])
    const finite = new Float32Array([1])
    const masked = composeRgb(
      {
        slots: [nan, nan, nan],
        limits: unit,
        linked: false,
        gains: gains(1),
        a: ASINH_SOFTENING,
        maskRGB: MASK,
      },
      1,
      1,
    )
    expect([masked[0], masked[1], masked[2], masked[3]]).toEqual([9, 8, 7, 255])
    const partial = composeRgb(
      {
        slots: [finite, nan, nan],
        limits: unit,
        linked: false,
        gains: gains(1),
        a: ASINH_SOFTENING,
        maskRGB: MASK,
      },
      1,
      1,
    )
    expect([partial[0], partial[1], partial[2]]).toEqual([255, 0, 0])

    const red = new Float32Array([10])
    const green = new Float32Array([0])
    const blue = new Float32Array([50])
    const perSlot = [limits(0, 10), limits(0, 100), limits(50, 50)] as const
    const unlinked = composeRgb(
      { slots: [red, green, blue], limits: perSlot, linked: false, gains: gains(1), a: ASINH_SOFTENING, maskRGB: MASK },
      1,
      1,
    )
    const linked = composeRgb(
      { slots: [red, green, blue], limits: perSlot, linked: true, gains: gains(1), a: ASINH_SOFTENING, maskRGB: MASK },
      1,
      1,
    )
    const unlinkedRed = unlinked[0] ?? 0
    const linkedRed = linked[0] ?? 0
    const unlinkedBlue = unlinked[2] ?? 0
    const linkedBlue = linked[2] ?? 0
    expect(unlinkedRed).toBe(255)
    expect(linkedRed).toBe(stretched(10, 0, 100, 1))
    expect(linkedRed).toBeLessThan(unlinkedRed)
    expect(unlinkedBlue).toBe(0)
    expect(linkedBlue).toBe(stretched(50, 0, 100, 1))
  })

  it('places a bright binary (0, 0) pixel at the bottom-left of the canvas', () => {
    const H = 3
    const W = 2
    const red = new Float32Array(H * W)
    red[0] = 1
    const rest = new Float32Array(H * W)
    const out = composeRgb(
      {
        slots: [red, rest, rest],
        limits: [limits(0, 1), limits(0, 1), limits(0, 1)],
        linked: false,
        gains: gains(1),
        a: ASINH_SOFTENING,
        maskRGB: MASK,
      },
      H,
      W,
    )
    const bottomLeft = ((H - 1) * W) * 4
    expect([out[bottomLeft], out[bottomLeft + 1], out[bottomLeft + 2]]).toEqual([255, 0, 0])
    expect(out[0]).toBe(0)
  })
})
