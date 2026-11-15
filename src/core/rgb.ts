/**
 * False-colour RGB compositor. FRONTEND_SPEC §12.1, §12.2, §12.4.
 * Slot planes stay in binary order until `composeRgb`, which is the only
 * caller of `toCanvasOrder` here. Feature RGB (F14) reuses `combineInverseVariance`.
 */
import type { Coadd, RgbPresets } from '../contract/types'
import { toCanvasOrder } from './binary'
import { percentile, type MaskRgb, type StretchLimits } from './stretch'

/** Slot gain range. Values outside it are clamped before the stretch. */
export const RGB_GAIN_MIN = 0.5
export const RGB_GAIN_MAX = 2

export interface RgbMember {
  /** Intensity plane, binary order. */
  I: Float32Array
  /** Uncertainty plane, binary order. Weight is `1 / sigma^2`. */
  sigma: Float32Array
}

export interface RgbCombined {
  I: Float32Array
  /** Variance of the inverse-variance mean, `1 / sum(w)`. */
  V: Float32Array
}

export type RgbMemberPreset = 'detector' | 'equal_channel'

/** Coadd indexes in `coadds` order. Named members missing from `coadds` are omitted. */
export interface RgbMembers {
  blue: number[]
  green: number[]
  red: number[]
}

export interface RgbGains {
  red: number
  green: number
  blue: number
}

export interface ComposeRgbInput {
  /** Intensity planes in binary order, red then green then blue. Null renders as 0. */
  slots: readonly [Float32Array | null, Float32Array | null, Float32Array | null]
  /** Per-slot percentile limits, same order as `slots`. */
  limits: readonly [StretchLimits, StretchLimits, StretchLimits]
  /** `lo = min(lo_slot)`, `hi = max(hi_slot)` across finite slot limits. */
  linked: boolean
  gains: RgbGains
  /** Asinh softening. Callers pass `ASINH_SOFTENING`. */
  a: number
  maskRGB: MaskRgb
}

/** Clamp one gain into `[RGB_GAIN_MIN, RGB_GAIN_MAX]`. Non-finite input becomes 1. */
export function clampRgbGain(gain: number): number {
  if (!Number.isFinite(gain)) return 1
  if (gain < RGB_GAIN_MIN) return RGB_GAIN_MIN
  if (gain > RGB_GAIN_MAX) return RGB_GAIN_MAX
  return gain
}

/**
 * Inverse-variance mean of coadd planes. FRONTEND_SPEC §12.1.
 * A sample counts only when `I` is finite and `sigma > 0`. Otherwise it is skipped.
 * The pixel is NaN in both planes when no member qualifies. Empty input yields empty planes.
 * Every member is read at the length of the first `I` plane.
 */
export function combineInverseVariance(members: readonly RgbMember[]): RgbCombined {
  const first = members[0]
  const n = first?.I.length ?? 0
  const I = new Float32Array(n)
  const V = new Float32Array(n)
  for (let p = 0; p < n; p += 1) {
    let sumW = 0
    let sumWI = 0
    for (const member of members) {
      const intensity = member.I[p]
      const sigma = member.sigma[p]
      if (intensity === undefined || sigma === undefined) continue
      if (!Number.isFinite(intensity) || !Number.isFinite(sigma) || !(sigma > 0)) continue
      const weight = 1 / (sigma * sigma)
      sumW += weight
      sumWI += weight * intensity
    }
    if (!(sumW > 0)) {
      I[p] = Number.NaN
      V[p] = Number.NaN
      continue
    }
    I[p] = sumWI / sumW
    V[p] = 1 / sumW
  }
  return { I, V }
}

function pushIndex(bucket: number[], index: number): void {
  bucket.push(index)
}

/**
 * Coadd indexes for one preset. FRONTEND_SPEC §12.2.
 * Detector RGB reads `detector_rgb.{blue,green,red}`.
 * Equal-channel RGB reads `equal_channel_rgb.{blue,green,red}_channels`.
 * A null `detector_rgb` yields three empty lists. Iteration follows `coadds`.
 */
export function selectMembers(preset: RgbMemberPreset, coadds: readonly Coadd[], rgbPresets: RgbPresets): RgbMembers {
  const blue: number[] = []
  const green: number[] = []
  const red: number[] = []
  if (preset === 'detector') {
    const groups = rgbPresets.detector_rgb
    if (!groups) return { blue, green, red }
    const blueSet = new Set<number>(groups.blue)
    const greenSet = new Set<number>(groups.green)
    const redSet = new Set<number>(groups.red)
    for (const coadd of coadds) {
      if (coadd.scope !== 'detector' || coadd.detector === null) continue
      if (blueSet.has(coadd.detector)) pushIndex(blue, coadd.index)
      else if (greenSet.has(coadd.detector)) pushIndex(green, coadd.index)
      else if (redSet.has(coadd.detector)) pushIndex(red, coadd.index)
    }
    return { blue, green, red }
  }
  const channels = rgbPresets.equal_channel_rgb
  const blueSet = new Set<number>(channels.blue_channels)
  const greenSet = new Set<number>(channels.green_channels)
  const redSet = new Set<number>(channels.red_channels)
  for (const coadd of coadds) {
    if (coadd.scope !== 'channel' || coadd.channel === null) continue
    if (blueSet.has(coadd.channel)) pushIndex(blue, coadd.index)
    else if (greenSet.has(coadd.channel)) pushIndex(green, coadd.index)
    else if (redSet.has(coadd.channel)) pushIndex(red, coadd.index)
  }
  return { blue, green, red }
}

/** Percentile limits of one slot's finite pixels. Empty or all-NaN input is NaN/NaN. */
export function slotLimits(I: Float32Array, lowerPct: number, upperPct: number): StretchLimits {
  return { lo: percentile(I, lowerPct), hi: percentile(I, upperPct) }
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function linkedLimits(limits: readonly [StretchLimits, StretchLimits, StretchLimits]): StretchLimits {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const limit of limits) {
    if (Number.isFinite(limit.lo)) lo = Math.min(lo, limit.lo)
    if (Number.isFinite(limit.hi)) hi = Math.max(hi, limit.hi)
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 0 }
  return { lo, hi }
}

function stretchSample(value: number, lo: number, hi: number, a: number, gain: number): number {
  if (!(hi > lo) || !(a > 0)) return 0
  const t = clamp01((value - lo) / (hi - lo))
  const stretched = Math.asinh(t / a) / Math.asinh(1 / a)
  return clamp01(stretched * gain)
}

/**
 * Stretch three slots into canvas-order RGBA. FRONTEND_SPEC §12.4.
 * Each finite slot is flipped with `toCanvasOrder` and no other flip.
 * A NaN sample contributes 0. A pixel that is NaN in all three slots uses `maskRGB`.
 */
export function composeRgb(input: ComposeRgbInput, H: number, W: number): Uint8ClampedArray {
  const { slots, limits, linked, gains, a, maskRGB } = input
  const ordered = slots.map((slot) => (slot === null ? null : toCanvasOrder(slot, H, W)))
  const shared = linked ? linkedLimits(limits) : null
  const gain = [clampRgbGain(gains.red), clampRgbGain(gains.green), clampRgbGain(gains.blue)]
  const out = new Uint8ClampedArray(H * W * 4)
  const [maskR, maskG, maskB] = maskRGB
  const n = H * W
  for (let i = 0; i < n; i += 1) {
    let nanSlots = 0
    const channel = [0, 0, 0]
    for (let s = 0; s < 3; s += 1) {
      const plane = ordered[s]
      if (plane === null || plane === undefined) continue
      const value = plane[i]
      if (value === undefined || !Number.isFinite(value)) {
        nanSlots += 1
        continue
      }
      const slotLimitsFor = shared ?? limits[s]
      const lo = slotLimitsFor?.lo ?? Number.NaN
      const hi = slotLimitsFor?.hi ?? Number.NaN
      const slotGain = gain[s] ?? 1
      channel[s] = Math.round(255 * stretchSample(value, lo, hi, a, slotGain))
    }
    const offset = i * 4
    if (nanSlots === 3) {
      out[offset] = maskR
      out[offset + 1] = maskG
      out[offset + 2] = maskB
    } else {
      out[offset] = channel[0] ?? 0
      out[offset + 1] = channel[1] ?? 0
      out[offset + 2] = channel[2] ?? 0
    }
    out[offset + 3] = 255
  }
  return out
}
