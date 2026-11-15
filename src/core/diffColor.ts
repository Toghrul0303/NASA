/**
 * Diverging colour map for difference images. FRONTEND_SPEC §11.3, §15.3.
 * Negative is blue `#2B6CB0`, zero is neutral `#E5E7EB`, positive is orange `#DD6B20`.
 * Input is in binary order; output RGBA is in canvas order via `toCanvasOrder`.
 */
import { toCanvasOrder } from './binary'
import { MASK_RGB, asinhValue, type MaskRgb } from './stretch'

const NEGATIVE: MaskRgb = [0x2b, 0x6c, 0xb0]
const NEUTRAL: MaskRgb = [0xe5, 0xe7, 0xeb]
const POSITIVE: MaskRgb = [0xdd, 0x6b, 0x20]

function mix(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}

/** Colour for `s` in `[-1, 1]` (values outside are clamped). */
export function divergingRgb(s: number): MaskRgb {
  const clamped = Math.max(-1, Math.min(1, s))
  const end = clamped < 0 ? NEGATIVE : POSITIVE
  const t = Math.abs(clamped)
  return [mix(NEUTRAL[0], end[0], t), mix(NEUTRAL[1], end[1], t), mix(NEUTRAL[2], end[2], t)]
}

/** Linear `S` map over `[-clip, +clip]`, values clamped. NaN stays NaN. Binary order in and out. */
export function normalizeLinear(S: Float32Array, clip: number): Float32Array {
  const out = new Float32Array(S.length)
  for (let i = 0; i < S.length; i += 1) {
    const value = S[i] ?? Number.NaN
    out[i] = Number.isNaN(value) ? Number.NaN : Math.max(-1, Math.min(1, value / clip))
  }
  return out
}

/**
 * Signed asinh `D` map: `u = clamp(D / L, -1, 1)`, `s = sign(u) * asinh(|u| / a) / asinh(1 / a)`.
 * `L` is the caller's percentile of `|D|`. A non-positive or non-finite `L` gives 0 for every finite pixel.
 */
export function normalizeSignedAsinh(D: Float32Array, limit: number, a: number): Float32Array {
  const out = new Float32Array(D.length)
  const usable = Number.isFinite(limit) && limit > 0
  for (let i = 0; i < D.length; i += 1) {
    const value = D[i] ?? Number.NaN
    if (Number.isNaN(value)) {
      out[i] = Number.NaN
      continue
    }
    if (!usable) {
      out[i] = 0
      continue
    }
    const u = Math.max(-1, Math.min(1, value / limit))
    out[i] = Math.sign(u) * asinhValue(Math.abs(u), 0, 1, a)
  }
  return out
}

/**
 * Map normalised values (`[-1, 1]`, binary order) to RGBA in canvas order.
 * NaN receives `maskRgb`.
 */
export function divergingRgba(
  normalized: Float32Array,
  H: number,
  W: number,
  maskRgb: MaskRgb = MASK_RGB,
): Uint8ClampedArray {
  const ordered = toCanvasOrder(normalized, H, W)
  const rgba = new Uint8ClampedArray(H * W * 4)
  for (let i = 0; i < ordered.length; i += 1) {
    const value = ordered[i]
    const offset = i * 4
    const [r, g, b] = value === undefined || Number.isNaN(value) ? maskRgb : divergingRgb(value)
    rgba[offset] = r
    rgba[offset + 1] = g
    rgba[offset + 2] = b
    rgba[offset + 3] = 255
  }
  return rgba
}
