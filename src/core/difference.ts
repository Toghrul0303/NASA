/**
 * Difference imaging maths and pairing rules. FRONTEND_SPEC §11.1, §11.2, §11.4.
 * Planes stay in binary order (`y = 0` southernmost). No flip happens here.
 * This module does not touch React or the DOM.
 */
import { ALIGN_GOOD_PX, ALIGN_POOR_PX } from '../config/constants'
import type { Coadd, Detector, Frame } from '../contract/types'
import { selectEpochCoadds, selectFrames } from './blink'
import { percentile, type StretchLimits } from './stretch'

/** One operand: intensity (plane 0) and its 1-sigma (plane 1), both MJy/sr. */
export interface DiffPlanes {
  I: Float32Array
  sigma: Float32Array
}

export interface DifferenceResult {
  /** `I_A - I_B`. */
  D: Float32Array
  /** `sqrt(sigma_A^2 + sigma_B^2)`. */
  sigmaD: Float32Array
  /** `D / sigma_D`. */
  S: Float32Array
}

/**
 * `D = A - B`, `sigma_D = sqrt(sA^2 + sB^2)`, `S = D / sigma_D`.
 * A pixel is NaN in all three outputs when any input is NaN or `sigma_D` is not a finite number above 0.
 */
export function computeDifference(A: DiffPlanes, B: DiffPlanes): DifferenceResult {
  const n = A.I.length
  if (A.sigma.length !== n || B.I.length !== n || B.sigma.length !== n) {
    throw new RangeError('difference operands must have the same number of pixels')
  }
  const D = new Float32Array(n)
  const sigmaD = new Float32Array(n)
  const S = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const ia = A.I[i] ?? Number.NaN
    const ib = B.I[i] ?? Number.NaN
    const sa = A.sigma[i] ?? Number.NaN
    const sb = B.sigma[i] ?? Number.NaN
    const sd = Math.sqrt(sa * sa + sb * sb)
    const d = ia - ib
    if (Number.isNaN(d) || !Number.isFinite(sd) || !(sd > 0)) {
      D[i] = Number.NaN
      sigmaD[i] = Number.NaN
      S[i] = Number.NaN
      continue
    }
    D[i] = d
    sigmaD[i] = sd
    S[i] = d / sd
  }
  return { D, sigmaD, S }
}

/**
 * Symmetric range `[-L, +L]` with `L = percentile(|values|, pct)` over finite pixels.
 * NaN limits when no pixel is finite.
 */
export function symmetricLimits(values: Float32Array, pct: number): StretchLimits {
  const magnitudes = new Float32Array(values.length)
  for (let i = 0; i < values.length; i += 1) magnitudes[i] = Math.abs(values[i] ?? Number.NaN)
  const limit = percentile(magnitudes, pct)
  if (Number.isNaN(limit)) return { lo: Number.NaN, hi: Number.NaN }
  return { lo: -limit, hi: limit }
}

/** Number of finite pixels with `|S| >= level`. */
export function countAtLeast(S: Float32Array, level: number): number {
  let count = 0
  for (let i = 0; i < S.length; i += 1) {
    const value = S[i]
    if (value !== undefined && Number.isFinite(value) && Math.abs(value) >= level) count += 1
  }
  return count
}

/**
 * Largest finite `|S|` within `radiusPx` of the grid position `(cx, cy)` (binary coordinates,
 * pixel centres at integers). NaN when no finite pixel falls inside.
 */
export function maxAbsWithin(S: Float32Array, H: number, W: number, cx: number, cy: number, radiusPx: number): number {
  let best = Number.NaN
  const y0 = Math.max(0, Math.floor(cy - radiusPx))
  const y1 = Math.min(H - 1, Math.ceil(cy + radiusPx))
  const x0 = Math.max(0, Math.floor(cx - radiusPx))
  const x1 = Math.min(W - 1, Math.ceil(cx + radiusPx))
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (Math.hypot(x - cx, y - cy) > radiusPx) continue
      const value = S[y * W + x]
      if (value === undefined || !Number.isFinite(value)) continue
      const magnitude = Math.abs(value)
      if (Number.isNaN(best) || magnitude > best) best = magnitude
    }
  }
  return best
}

export type DiffMode = 'temporal' | 'spectral'

/** A frame (`frames.bin`) or a coadd (`coadds.bin`) item. */
export interface DiffOperand {
  kind: 'frame' | 'coadd'
  index: number
}

export type DiffEmpty = 'needs_two' | 'identical'

export function sameOperand(a: DiffOperand, b: DiffOperand): boolean {
  return a.kind === b.kind && a.index === b.index
}

/** Why a pair cannot be shown, or `null` when it can be differenced. */
export function emptyReason(a: DiffOperand | null, b: DiffOperand | null): DiffEmpty | null {
  if (!a || !b) return 'needs_two'
  if (sameOperand(a, b)) return 'identical'
  return null
}

export type PairingIssue =
  | 'mixed_kinds'
  | 'detector'
  | 'epoch'
  | 'wavelength_match'
  | 'wavelength_differ'
  | 'scope'
  | 'same_epoch'

export interface PairingContext {
  frames: readonly Frame[]
  coadds: readonly Coadd[]
}

function frameAt(ctx: PairingContext, operand: DiffOperand): Frame | undefined {
  return operand.kind === 'frame' ? ctx.frames[operand.index] : undefined
}

function coaddAt(ctx: PairingContext, operand: DiffOperand): Coadd | undefined {
  return operand.kind === 'coadd' ? ctx.coadds[operand.index] : undefined
}

/**
 * §11.1 pairing constraint for `mode`. Returns the violated rules (empty when valid).
 * Temporal: same detector, different epoch, matched wavelength for frames.
 * Spectral: shared epoch (or two `detector` coadds) and wavelengths that differ by more than `bandwidth_A`.
 */
export function pairingIssues(mode: DiffMode, ctx: PairingContext, a: DiffOperand, b: DiffOperand): PairingIssue[] {
  if (a.kind !== b.kind) return ['mixed_kinds']
  const issues: PairingIssue[] = []
  if (a.kind === 'frame') {
    const fa = frameAt(ctx, a)
    const fb = frameAt(ctx, b)
    if (!fa || !fb) return ['mixed_kinds']
    const dl = Math.abs(fa.lambda_um - fb.lambda_um)
    if (mode === 'temporal') {
      if (fa.detector !== fb.detector) issues.push('detector')
      if (fa.epoch_id === fb.epoch_id) issues.push('epoch')
      if (!(dl <= fa.bandwidth_um)) issues.push('wavelength_match')
    } else {
      if (fa.epoch_id !== fb.epoch_id) issues.push('same_epoch')
      if (!(dl > fa.bandwidth_um)) issues.push('wavelength_differ')
    }
    return issues
  }
  const ca = coaddAt(ctx, a)
  const cb = coaddAt(ctx, b)
  if (!ca || !cb) return ['mixed_kinds']
  if (mode === 'temporal') {
    if (ca.scope !== 'epoch_detector' || cb.scope !== 'epoch_detector') issues.push('scope')
    if (ca.detector !== cb.detector) issues.push('detector')
    if (ca.epoch_id === cb.epoch_id) issues.push('epoch')
    return issues
  }
  const bothEpoch = ca.scope === 'epoch_detector' && cb.scope === 'epoch_detector'
  const bothDetector = ca.scope === 'detector' && cb.scope === 'detector'
  if (!bothEpoch && !bothDetector) issues.push('scope')
  if (bothEpoch && ca.epoch_id !== cb.epoch_id) issues.push('same_epoch')
  // A coadd spans a range rather than one bandwidth. Neighbouring detectors overlap slightly at their
  // edges, so "differ" means the ranges overlap by less than half of the narrower one.
  const overlap = Math.min(ca.lambda_max_um, cb.lambda_max_um) - Math.max(ca.lambda_min_um, cb.lambda_min_um)
  const narrower = Math.min(ca.lambda_max_um - ca.lambda_min_um, cb.lambda_max_um - cb.lambda_min_um)
  if (!(overlap < 0.5 * narrower)) issues.push('wavelength_differ')
  return issues
}

/** True for two `detector`-scope coadds in Spectral mode, which are static-sky only. */
export function isStaticSkyPair(ctx: PairingContext, a: DiffOperand, b: DiffOperand): boolean {
  const ca = coaddAt(ctx, a)
  const cb = coaddAt(ctx, b)
  return ca?.scope === 'detector' && cb?.scope === 'detector'
}

/** Alignment residual of one operand, px. `null` is unknown. §11.4. */
export function operandResidual(ctx: PairingContext, operand: DiffOperand): number | null {
  const frame = frameAt(ctx, operand)
  if (frame) return frame.alignment_residual_px
  const coadd = coaddAt(ctx, operand)
  if (!coadd) return null
  let worst = 0
  for (const index of coadd.frame_indices) {
    const residual = ctx.frames[index]?.alignment_residual_px
    if (residual === null || residual === undefined) return null
    if (residual > worst) worst = residual
  }
  return coadd.frame_indices.length === 0 ? null : worst
}

/** `sqrt(rA^2 + rB^2)`, or `null` when either operand is unknown. */
export function pairResidual(rA: number | null, rB: number | null): number | null {
  if (rA === null || rB === null) return null
  return Math.sqrt(rA * rA + rB * rB)
}

export type AlignmentState = 'good' | 'caution' | 'poor' | 'unknown'

/** `< ALIGN_GOOD_PX` good, `< ALIGN_POOR_PX` caution, otherwise poor. `null` is unknown. */
export function alignmentState(rPair: number | null): AlignmentState {
  if (rPair === null) return 'unknown'
  if (rPair < ALIGN_GOOD_PX) return 'good'
  if (rPair < ALIGN_POOR_PX) return 'caution'
  return 'poor'
}

export interface DiffPair {
  a: DiffOperand
  b: DiffOperand
}

/**
 * Default Temporal pair: first and last epoch of one detector and wavelength window (frames).
 * The first frame of the earliest epoch is A. B is the frame of the latest epoch whose wavelength
 * is closest to A and still matched (`|dl| <= bandwidth_A`). Falls back to the first and last
 * `epoch_detector` coadd of the detector. `null` when neither exists.
 */
export function defaultTemporalPair(
  ctx: PairingContext,
  detector: Detector,
  lambda0: number,
  k: number,
): DiffPair | null {
  const inSet = selectFrames(ctx.frames, detector, lambda0, k).sort((p, q) => p.mjd - q.mjd)
  const first = inSet[0]
  const last = inSet[inSet.length - 1]
  if (first && last && last.epoch_id !== first.epoch_id) {
    let best: Frame | null = null
    for (const frame of inSet) {
      if (frame.epoch_id !== last.epoch_id) continue
      const dl = Math.abs(frame.lambda_um - first.lambda_um)
      if (!(dl <= first.bandwidth_um)) continue
      if (!best || dl < Math.abs(best.lambda_um - first.lambda_um)) best = frame
    }
    if (best) return { a: { kind: 'frame', index: first.index }, b: { kind: 'frame', index: best.index } }
  }
  const epochs = selectEpochCoadds(ctx.coadds, detector)
  const a = epochs[0]
  const b = epochs[epochs.length - 1]
  if (a && b && a !== b && a.epoch_id !== b.epoch_id) {
    return { a: { kind: 'coadd', index: a.index }, b: { kind: 'coadd', index: b.index } }
  }
  return null
}

/**
 * Default Spectral pair: the two `detector`-scope coadds with the highest `snr_target`
 * (a `null` ranks last). Falls back to two frames of the earliest epoch whose wavelengths differ the most.
 */
export function defaultSpectralPair(ctx: PairingContext): DiffPair | null {
  const detectorCoadds = ctx.coadds
    .filter((coadd) => coadd.scope === 'detector')
    .sort((p, q) => (q.snr_target ?? Number.NEGATIVE_INFINITY) - (p.snr_target ?? Number.NEGATIVE_INFINITY))
  const top = detectorCoadds[0]
  const second = detectorCoadds[1]
  if (top && second) {
    const pair = { a: { kind: 'coadd', index: top.index }, b: { kind: 'coadd', index: second.index } } as const
    if (pairingIssues('spectral', ctx, pair.a, pair.b).length === 0) return pair
  }
  const byEpoch = [...ctx.frames].sort((p, q) => p.mjd - q.mjd)
  const anchor = byEpoch[0]
  if (!anchor) return null
  let best: Frame | null = null
  for (const frame of byEpoch) {
    if (frame.epoch_id !== anchor.epoch_id) continue
    if (!(Math.abs(frame.lambda_um - anchor.lambda_um) > anchor.bandwidth_um)) continue
    if (!best || Math.abs(frame.lambda_um - anchor.lambda_um) > Math.abs(best.lambda_um - anchor.lambda_um)) {
      best = frame
    }
  }
  if (!best) return null
  return { a: { kind: 'frame', index: anchor.index }, b: { kind: 'frame', index: best.index } }
}
