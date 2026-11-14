/**
 * Percentile limits and asinh stretch. FRONTEND_SPEC §9.5.
 * Percentiles are the caller's `meta.previews.stretch` values, never literals here.
 * Softening `a` is `ASINH_SOFTENING` from `config/constants.ts`.
 */
import { ASINH_SOFTENING } from '../config/constants'
import type { PreviewStretch } from '../contract/types'

export { ASINH_SOFTENING }

export interface StretchLimits {
  lo: number
  hi: number
}

export type MaskRgb = readonly [number, number, number]

function finiteValues(values: Float32Array): Float32Array {
  let count = 0
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]
    if (value !== undefined && Number.isFinite(value)) count += 1
  }
  const finite = new Float32Array(count)
  let cursor = 0
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]
    if (value !== undefined && Number.isFinite(value)) {
      finite[cursor] = value
      cursor += 1
    }
  }
  return finite
}

/**
 * Linear interpolation between order statistics.
 * Position is `p/100 * (n - 1)` over the finite values. Empty input is NaN.
 * The input array is not reordered.
 */
export function percentile(values: Float32Array, p: number): number {
  const sorted = finiteValues(values)
  const n = sorted.length
  if (n === 0) return Number.NaN
  sorted.sort()
  const position = (p / 100) * (n - 1)
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const lower = sorted[lowerIndex]
  const upper = sorted[upperIndex]
  if (lower === undefined || upper === undefined) return Number.NaN
  return lower + (upper - lower) * (position - lowerIndex)
}

/** Union of finite samples across planes, then the two stretch percentiles. */
export function computeLimits(planes: Float32Array[], lowerPct: number, upperPct: number): StretchLimits {
  let count = 0
  for (const plane of planes) count += plane.length
  const joined = new Float32Array(count)
  let cursor = 0
  for (const plane of planes) {
    joined.set(plane, cursor)
    cursor += plane.length
  }
  return { lo: percentile(joined, lowerPct), hi: percentile(joined, upperPct) }
}

/**
 * Limits from `meta.previews.stretch`. The percentile numbers stay on the dataset.
 */
export function limitsFromStretch(planes: Float32Array[], stretch: PreviewStretch): StretchLimits {
  return computeLimits(planes, stretch.lower_percentile, stretch.upper_percentile)
}

function clamp01(t: number): number {
  if (t < 0) return 0
  if (t > 1) return 1
  return t
}

/**
 * Asinh stretch of one value. `s = 0` for every value when `hi <= lo`
 * (flat or empty limits). `a` is `ASINH_SOFTENING`.
 */
export function asinhValue(v: number, lo: number, hi: number, a: number): number {
  if (!(hi > lo)) return 0
  const t = clamp01((v - lo) / (hi - lo))
  return Math.asinh(t / a) / Math.asinh(1 / a)
}

/**
 * Write RGBA for a plane that is already in canvas order. No DOM.
 * NaN pixels receive `maskRgb`; finite pixels are grayscale `round(255 * s)`.
 */
export function renderGrayscale(
  planeCanvasOrder: Float32Array,
  lo: number,
  hi: number,
  a: number,
  maskRgb: MaskRgb,
  outRGBA: Uint8ClampedArray,
): void {
  const [maskR, maskG, maskB] = maskRgb
  for (let i = 0; i < planeCanvasOrder.length; i += 1) {
    const value = planeCanvasOrder[i]
    const offset = i * 4
    if (value === undefined || Number.isNaN(value)) {
      outRGBA[offset] = maskR
      outRGBA[offset + 1] = maskG
      outRGBA[offset + 2] = maskB
      outRGBA[offset + 3] = 255
      continue
    }
    const sample = Math.round(255 * asinhValue(value, lo, hi, a))
    outRGBA[offset] = sample
    outRGBA[offset + 1] = sample
    outRGBA[offset + 2] = sample
    outRGBA[offset + 3] = 255
  }
}
