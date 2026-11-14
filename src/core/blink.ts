/**
 * Blink selection and set-wide stretch limits. FRONTEND_SPEC §10.1, §10.2, §9.5.
 * Limits are computed once for every plane-0 array in the set so brightness
 * does not flicker from frame to frame. This module does not touch React or the DOM.
 */
import type { Coadd, Detector, Epoch, Frame } from '../contract/types'
import { computeLimits, type StretchLimits } from './stretch'

export type BlinkMode = 'frames' | 'epochs'

export const DETECTORS = [1, 2, 3, 4, 5, 6] as const satisfies readonly Detector[]

/** Half-width factor `k`. FRONTEND_SPEC §10.2. */
export const K_MIN = 0.25
export const K_MAX = 3
export const K_DEFAULT = 1

/** Playback rate. FRONTEND_SPEC §10.2. */
export const FPS_MIN = 1
export const FPS_MAX = 10
export const FPS_DEFAULT = 2

export interface LambdaBin {
  /** Lower edge, µm. */
  x0: number
  /** Upper edge, µm. The last bin includes values equal to this edge. */
  x1: number
  count: number
}

function isDetector(value: number): value is Detector {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6
}

/** Detectors listed on `epochs[*].detectors`, in ascending detector number. */
export function enabledDetectors(epochs: readonly Epoch[]): Detector[] {
  const present = new Set<number>()
  for (const epoch of epochs) {
    for (const detector of epoch.detectors) present.add(detector)
  }
  return DETECTORS.filter((detector) => present.has(detector))
}

/**
 * Detector with the most frames. An equal count stays with the lower number.
 * An empty list returns detector 1.
 */
export function defaultDetector(frames: readonly Frame[]): Detector {
  const counts = new Map<Detector, number>()
  for (const frame of frames) {
    if (!isDetector(frame.detector)) continue
    counts.set(frame.detector, (counts.get(frame.detector) ?? 0) + 1)
  }
  let best: Detector = 1
  let bestCount = -1
  for (const detector of DETECTORS) {
    const count = counts.get(detector) ?? 0
    if (count > bestCount) {
      best = detector
      bestCount = count
    }
  }
  return best
}

/**
 * `|lambda_um - lambda0| <= k * bandwidth_um`, using this frame's own bandwidth.
 * The edge is inclusive.
 */
export function inWindow(frame: Frame, lambda0: number, k: number): boolean {
  return Math.abs(frame.lambda_um - lambda0) <= k * frame.bandwidth_um
}

/**
 * Among the distinct `lambda_um` values of `detector`, the centre whose window
 * contains the most of that detector's frames. Ties resolve to the lower wavelength.
 * Returns NaN when the detector has no frames.
 */
export function defaultLambda0(frames: readonly Frame[], detector: Detector, k = K_DEFAULT): number {
  const wavelengths: number[] = []
  const seen = new Set<number>()
  for (const frame of frames) {
    if (frame.detector !== detector || seen.has(frame.lambda_um)) continue
    seen.add(frame.lambda_um)
    wavelengths.push(frame.lambda_um)
  }
  let best = Number.NaN
  let bestCount = -1
  for (const lambda0 of wavelengths) {
    let count = 0
    for (const frame of frames) {
      if (frame.detector === detector && inWindow(frame, lambda0, k)) count += 1
    }
    if (count > bestCount || (count === bestCount && lambda0 < best)) {
      best = lambda0
      bestCount = count
    }
  }
  return best
}

/** Frames of `detector` inside the window, in `frames.json` order. */
export function selectFrames(frames: readonly Frame[], detector: Detector, lambda0: number, k: number): Frame[] {
  const selected: Frame[] = []
  for (const frame of frames) {
    if (frame.detector === detector && inWindow(frame, lambda0, k)) selected.push(frame)
  }
  return selected
}

/** `epoch_detector` coadds of `detector`, ordered by `epoch_id`. */
export function selectEpochCoadds(coadds: readonly Coadd[], detector: Detector): Coadd[] {
  const selected: Coadd[] = []
  for (const coadd of coadds) {
    if (coadd.scope === 'epoch_detector' && coadd.detector === detector) selected.push(coadd)
  }
  selected.sort((a, b) => (a.epoch_id ?? Number.POSITIVE_INFINITY) - (b.epoch_id ?? Number.POSITIVE_INFINITY))
  return selected
}

/**
 * Equal-width counts of `lambda_um` for `detector`.
 * A zero-width sample (every frame at one wavelength) is a single bin.
 * `bins` below 1 yields an empty list.
 */
export function lambdaHistogram(frames: readonly Frame[], detector: Detector, bins: number): LambdaBin[] {
  const binCount = Math.floor(bins)
  if (binCount < 1) return []
  const values: number[] = []
  for (const frame of frames) {
    if (frame.detector === detector) values.push(frame.lambda_um)
  }
  const first = values[0]
  if (first === undefined) return []
  let min = first
  let max = first
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  if (!(max > min)) return [{ x0: min, x1: min, count: values.length }]

  const width = (max - min) / binCount
  const counts: number[] = []
  for (let index = 0; index < binCount; index += 1) counts.push(0)
  for (const value of values) {
    let index = Math.floor((value - min) / width)
    if (index < 0) index = 0
    if (index >= binCount) index = binCount - 1
    const current = counts[index]
    if (current !== undefined) counts[index] = current + 1
  }
  return counts.map((count, index) => ({
    x0: min + index * width,
    x1: index === binCount - 1 ? max : min + (index + 1) * width,
    count,
  }))
}

/**
 * Stretch limits for a blink set. Pass plane 0 of every item in the set
 * (frames or epoch coadds). The percentiles are `meta.previews.stretch`.
 */
export function blinkLimits(planes: Float32Array[], lowerPct: number, upperPct: number): StretchLimits {
  return computeLimits(planes, lowerPct, upperPct)
}

/** Cache key for one blink set. Limits are stored under this key, not per frame. */
export function setKey(mode: BlinkMode, detector: Detector, lambda0: number, k: number): string {
  return `${mode}:${detector}:${lambda0}:${k}`
}
