import { describe, expect, it } from 'vitest'
import type { Coadd, Frame } from '../../src/contract/types'
import { contourLines } from '../../src/core/contours'
import {
  alignmentState,
  computeDifference,
  countAtLeast,
  defaultSpectralPair,
  defaultTemporalPair,
  emptyReason,
  isStaticSkyPair,
  maxAbsWithin,
  operandResidual,
  pairingIssues,
  pairResidual,
  symmetricLimits,
} from '../../src/core/difference'
import { divergingRgb, divergingRgba, normalizeLinear } from '../../src/core/diffColor'
import { MASK_RGB } from '../../src/core/stretch'

const NaN_ = Number.NaN

describe('computeDifference', () => {
  it('matches hand-computed D, sigma_D and S', () => {
    const A = { I: new Float32Array([5, 3, 0, 2]), sigma: new Float32Array([3, 2, 1, 1]) }
    const B = { I: new Float32Array([1, -2, 0, 4]), sigma: new Float32Array([4, 1.5, 1, 0]) }
    const { D, sigmaD, S } = computeDifference(A, B)
    // px0: D = 4, sigma_D = sqrt(9 + 16) = 5, S = 0.8
    expect(D[0]).toBe(4)
    expect(sigmaD[0]).toBe(5)
    expect(S[0]).toBeCloseTo(0.8, 6)
    // px1: D = 5, sigma_D = sqrt(4 + 2.25) = 2.5, S = 2
    expect(D[1]).toBe(5)
    expect(sigmaD[1]).toBe(2.5)
    expect(S[1]).toBe(2)
    // px2: D = 0 with sigma_D = sqrt(2): S = 0
    expect(D[2]).toBe(0)
    expect(sigmaD[2]).toBeCloseTo(Math.SQRT2, 6)
    expect(S[2]).toBe(0)
    // px3: D = -2, sigma_D = 1, S = -2
    expect(D[3]).toBe(-2)
    expect(sigmaD[3]).toBe(1)
    expect(S[3]).toBe(-2)
  })

  it('gives NaN in all three outputs for NaN input or sigma_D <= 0', () => {
    const A = { I: new Float32Array([NaN_, 1, 1, 1]), sigma: new Float32Array([1, 1, 0, 1]) }
    const B = { I: new Float32Array([1, NaN_, 0, 0]), sigma: new Float32Array([1, 1, 0, 1]) }
    const { D, sigmaD, S } = computeDifference(A, B)
    for (const index of [0, 1, 2]) {
      expect(D[index]).toBeNaN()
      expect(sigmaD[index]).toBeNaN()
      expect(S[index]).toBeNaN()
    }
    expect(D[3]).toBe(1)
    expect(sigmaD[3]).toBeCloseTo(Math.SQRT2, 6)
  })

  it('treats a NaN or infinite sigma as invalid', () => {
    const A = { I: new Float32Array([1, 1]), sigma: new Float32Array([NaN_, Number.POSITIVE_INFINITY]) }
    const B = { I: new Float32Array([0, 0]), sigma: new Float32Array([1, 1]) }
    const { S } = computeDifference(A, B)
    expect(S[0]).toBeNaN()
    expect(S[1]).toBeNaN()
  })

  it('rejects operands of different size', () => {
    const A = { I: new Float32Array(4), sigma: new Float32Array(4) }
    const B = { I: new Float32Array(3), sigma: new Float32Array(3) }
    expect(() => computeDifference(A, B)).toThrow(RangeError)
  })
})

describe('symmetricLimits', () => {
  it('is symmetric about 0 from a percentile of |S| over finite pixels', () => {
    const S = new Float32Array([-4, 1, 2, NaN_])
    expect(symmetricLimits(S, 100)).toEqual({ lo: -4, hi: 4 })
    expect(symmetricLimits(S, 50)).toEqual({ lo: -2, hi: 2 })
  })

  it('is NaN when nothing is finite', () => {
    const limits = symmetricLimits(new Float32Array([NaN_, NaN_]), 99.5)
    expect(limits.lo).toBeNaN()
    expect(limits.hi).toBeNaN()
  })
})

describe('summary helpers', () => {
  it('counts |S| >= level and finds the local maximum', () => {
    const S = new Float32Array([0, 3, -3, 2.9, NaN_, 0, 0, 0, 7])
    expect(countAtLeast(S, 3)).toBe(3)
    expect(maxAbsWithin(S, 3, 3, 1, 0, 1)).toBe(3)
    expect(maxAbsWithin(S, 3, 3, 0, 0, 0.4)).toBe(0)
    expect(maxAbsWithin(new Float32Array([NaN_]), 1, 1, 0, 0, 1)).toBeNaN()
  })

  it('combines residuals and classifies them with the spec thresholds', () => {
    expect(pairResidual(0.3, 0.4)).toBeCloseTo(0.5, 12)
    expect(pairResidual(null, 0.1)).toBeNull()
    expect(alignmentState(0.29)).toBe('good')
    expect(alignmentState(0.3)).toBe('caution')
    expect(alignmentState(0.5)).toBe('poor')
    expect(alignmentState(null)).toBe('unknown')
  })

  it('reports the two empty states', () => {
    expect(emptyReason(null, { kind: 'frame', index: 0 })).toBe('needs_two')
    expect(emptyReason({ kind: 'frame', index: 2 }, { kind: 'frame', index: 2 })).toBe('identical')
    expect(emptyReason({ kind: 'frame', index: 0 }, { kind: 'coadd', index: 0 })).toBeNull()
  })
})

describe('contourLines', () => {
  // 3 x 3, binary order, one pixel at the centre.
  const grid = (centre: number): Float32Array => new Float32Array([0, 0, 0, 0, centre, 0, 0, 0, 0])

  it('traces the +3 contour exactly as a closed diamond for a single peak', () => {
    const lines = contourLines(grid(6), 3, 3, 3)
    expect(lines).toHaveLength(1)
    const line = lines[0]
    expect(line?.closed).toBe(true)
    const points = (line?.points ?? []).map((p) => `${p.x},${p.y}`).sort()
    expect(points).toEqual(['0.5,1', '1,0.5', '1,1.5', '1.5,1'])
  })

  it('traces the -3 contour of a single trough at the same place', () => {
    const lines = contourLines(grid(-6), 3, 3, -3)
    expect(lines).toHaveLength(1)
    const points = (lines[0]?.points ?? []).map((p) => `${p.x},${p.y}`).sort()
    expect(points).toEqual(['0.5,1', '1,0.5', '1,1.5', '1.5,1'])
  })

  it('draws nothing when no value reaches the level', () => {
    expect(contourLines(grid(2.9), 3, 3, 3)).toHaveLength(0)
    expect(contourLines(grid(-2.9), 3, 3, -3)).toHaveLength(0)
  })

  it('interpolates the crossing between pixel centres', () => {
    const lines = contourLines(grid(4), 3, 3, 3)
    const xs = (lines[0]?.points ?? []).map((p) => p.x)
    // The edge from 0 to 4 crosses 3 at 3/4 of the way: 1 +/- 0.25.
    expect(Math.min(...xs)).toBeCloseTo(0.75, 6)
    expect(Math.max(...xs)).toBeCloseTo(1.25, 6)
  })

  it('skips cells with a NaN corner', () => {
    const S = new Float32Array([0, 0, 0, 0, 6, NaN_, 0, 0, 0])
    const lines = contourLines(S, 3, 3, 3)
    expect(lines.length).toBeGreaterThan(0)
    // Only the two left-hand cells are fully finite, so no vertex reaches x > 1.
    for (const line of lines) {
      for (const p of line.points) expect(p.x).toBeLessThanOrEqual(1)
    }
    expect(lines.every((line) => !line.closed)).toBe(true)
  })

  it('returns open lines at the grid edge', () => {
    const S = new Float32Array([6, 0, 0, 0, 0, 0, 0, 0, 0])
    const lines = contourLines(S, 3, 3, 3)
    expect(lines).toHaveLength(1)
    expect(lines[0]?.closed).toBe(false)
  })

  it('keeps every vertex on the level for a dipole', () => {
    const W = 6
    const H = 5
    const S = new Float32Array(W * H)
    S[2 * W + 1] = 5
    S[2 * W + 4] = -5
    const pos = contourLines(S, H, W, 3)
    const neg = contourLines(S, H, W, -3)
    expect(pos).toHaveLength(1)
    expect(neg).toHaveLength(1)
    for (const p of pos[0]?.points ?? []) expect(Math.abs(p.x - 1) + Math.abs(p.y - 2)).toBeLessThan(1)
    for (const p of neg[0]?.points ?? []) expect(Math.abs(p.x - 4) + Math.abs(p.y - 2)).toBeLessThan(1)
  })
})

describe('diverging colour map in canvas order', () => {
  const pixel = (rgba: Uint8ClampedArray, col: number, row: number, W: number): number[] => {
    const o = (row * W + col) * 4
    return [rgba[o] ?? -1, rgba[o + 1] ?? -1, rgba[o + 2] ?? -1, rgba[o + 3] ?? -1]
  }

  it('maps the endpoints and centre of the scale', () => {
    expect(divergingRgb(-1)).toEqual([0x2b, 0x6c, 0xb0])
    expect(divergingRgb(0)).toEqual([0xe5, 0xe7, 0xeb])
    expect(divergingRgb(1)).toEqual([0xdd, 0x6b, 0x20])
    expect(divergingRgb(5)).toEqual([0xdd, 0x6b, 0x20])
  })

  it('puts a bright pixel at binary (0, 0) at the bottom-left of the canvas', () => {
    const H = 3
    const W = 2
    const S = new Float32Array(H * W)
    S[0] = 5
    const rgba = divergingRgba(normalizeLinear(S, 5), H, W)
    expect(pixel(rgba, 0, H - 1, W)).toEqual([0xdd, 0x6b, 0x20, 255])
    expect(pixel(rgba, 0, 0, W)).toEqual([0xe5, 0xe7, 0xeb, 255])
    expect(pixel(rgba, 1, H - 1, W)).toEqual([0xe5, 0xe7, 0xeb, 255])
  })

  it('paints NaN with the mask colour', () => {
    const rgba = divergingRgba(new Float32Array([NaN_, 0]), 1, 2)
    expect(pixel(rgba, 0, 0, 2)).toEqual([...MASK_RGB, 255])
  })
})

describe('pairing and defaults', () => {
  const frame = (
    index: number,
    detector: 1 | 2,
    epoch_id: number,
    lambda_um: number,
    mjd: number,
    alignment_residual_px: number | null = 0.1,
  ): Frame =>
    ({
      index,
      detector,
      epoch_id,
      lambda_um,
      bandwidth_um: 0.05,
      mjd,
      alignment_residual_px,
    }) as unknown as Frame
  const coadd = (
    index: number,
    scope: 'epoch_detector' | 'detector',
    epoch_id: number | null,
    detector: 1 | 2 | null,
    lo: number,
    hi: number,
    snr: number | null,
    frame_indices: number[] = [],
  ): Coadd =>
    ({
      index,
      scope,
      epoch_id,
      detector,
      lambda_min_um: lo,
      lambda_max_um: hi,
      lambda_mean_um: (lo + hi) / 2,
      snr_target: snr,
      frame_indices,
    }) as unknown as Coadd
  const frames = [
    frame(0, 1, 0, 1.0, 10),
    frame(1, 1, 1, 1.02, 20),
    frame(2, 1, 2, 1.01, 30),
    frame(3, 2, 0, 1.5, 10.1),
    frame(4, 1, 2, 1.4, 30.1, null),
  ]
  const coadds = [
    coadd(0, 'epoch_detector', 0, 1, 0.9, 1.1, 5, [0]),
    coadd(1, 'epoch_detector', 2, 1, 0.9, 1.1, 5, [2, 4]),
    coadd(2, 'detector', null, 1, 0.9, 1.1, 10),
    coadd(3, 'detector', null, 2, 1.3, 1.7, 30),
    coadd(4, 'detector', null, 2, 1.0, 1.5, null),
  ]
  const ctx = { frames, coadds }
  const f = (index: number) => ({ kind: 'frame', index }) as const
  const c = (index: number) => ({ kind: 'coadd', index }) as const

  it('enforces the temporal and spectral frame rules', () => {
    expect(pairingIssues('temporal', ctx, f(0), f(2))).toEqual([])
    expect(pairingIssues('temporal', ctx, f(0), f(3))).toEqual(['detector', 'epoch', 'wavelength_match'])
    expect(pairingIssues('temporal', ctx, f(0), f(4))).toEqual(['wavelength_match'])
    expect(pairingIssues('spectral', ctx, f(0), f(3))).toEqual([])
    expect(pairingIssues('spectral', ctx, f(0), f(1))).toEqual(['same_epoch', 'wavelength_differ'])
    expect(pairingIssues('temporal', ctx, f(0), c(0))).toEqual(['mixed_kinds'])
  })

  it('enforces the coadd rules', () => {
    expect(pairingIssues('temporal', ctx, c(0), c(1))).toEqual([])
    expect(pairingIssues('temporal', ctx, c(2), c(3))).toEqual(['scope', 'detector', 'epoch'])
    expect(pairingIssues('spectral', ctx, c(2), c(3))).toEqual([])
    expect(pairingIssues('spectral', ctx, c(2), c(4))).toEqual(['wavelength_differ'])
    expect(isStaticSkyPair(ctx, c(2), c(3))).toBe(true)
    expect(isStaticSkyPair(ctx, c(0), c(1))).toBe(false)
  })

  it('takes the worst coadd residual, unknown when any member is null', () => {
    expect(operandResidual(ctx, f(0))).toBe(0.1)
    expect(operandResidual(ctx, c(0))).toBe(0.1)
    expect(operandResidual(ctx, c(1))).toBeNull()
    expect(operandResidual(ctx, c(2))).toBeNull()
  })

  it('defaults Temporal to the first and last epoch frames of the window', () => {
    expect(defaultTemporalPair(ctx, 1, 1.0, 1)).toEqual({ a: f(0), b: f(2) })
  })

  it('falls back to epoch coadds, then to nothing', () => {
    expect(defaultTemporalPair(ctx, 1, 9, 1)).toEqual({ a: c(0), b: c(1) })
    expect(defaultTemporalPair({ frames, coadds: [] }, 1, 9, 1)).toBeNull()
  })

  it('defaults Spectral to the two highest-SNR detector coadds', () => {
    expect(defaultSpectralPair(ctx)).toEqual({ a: c(3), b: c(2) })
    expect(defaultSpectralPair({ frames, coadds: [] })).toEqual({ a: f(0), b: f(3) })
  })
})
