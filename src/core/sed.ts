/**
 * SED and lambda-time shaping. FRONTEND_SPEC §13.1–§13.3.
 * Points stay discrete: nothing here joins or interpolates them.
 * No React and no DOM.
 */
import { median } from 'd3-array'
import { EPOCH_GAP_PX, EPOCH_MIN_SPAN_DAYS, LT_CELL_WIDTH_PX, LT_MIN_CELL_PX } from '../config/constants'
import type { ChannelRow, Epoch, Sed, SedPoint } from '../contract/types'
import { inWindow } from './blink'

export interface SedFilters {
  hideFlagged: boolean
  /** Detectors that stay visible. */
  detectors: ReadonlySet<number>
  hiddenEpochs: ReadonlySet<number>
  /** When set, only this epoch is drawn. */
  epochSlice: number | null
}

export interface DichroicBand {
  startUm: number
  endUm: number
}

export interface TimeSegment {
  epochId: number
  mjdStart: number
  mjdEnd: number
  /** `max(mjd_end - mjd_start, minSpanDays)`. */
  spanDays: number
  x0: number
  x1: number
}

export interface CompressedAxis {
  segments: TimeSegment[]
  /** Pixel centre of each fixed gap between segments. */
  breaks: number[]
  mjdToX: (epochId: number, mjd: number) => number
}

export interface TrueAxisBand {
  epochId: number
  mjdStart: number
  mjdEnd: number
  x0: number
  x1: number
}

export interface TrueAxis {
  mjdToX: (mjd: number) => number
  bands: TrueAxisBand[]
}

function apertureValue(values: readonly (number | null)[], apertureIndex: number): number | null {
  if (apertureIndex !== 0 && apertureIndex !== 1 && apertureIndex !== 2) return null
  const value = values[apertureIndex]
  return value === null || value === undefined ? null : value
}

/** Flux at the selected aperture, or null when that aperture has no photometry. */
export function fluxAt(point: SedPoint, apertureIndex: number): number | null {
  return apertureValue(point.flux_mjy, apertureIndex)
}

/** Uncertainty at the selected aperture. Null together with the flux (DC §8.2). */
export function fluxErrAt(point: SedPoint, apertureIndex: number): number | null {
  return apertureValue(point.flux_err_mjy, apertureIndex)
}

/**
 * Points that are drawn. A point is omitted when `flux_mjy[a]` is null,
 * when it is flagged and the hide toggle is on, when its detector is off,
 * when its epoch is hidden, or when an epoch slice names a different epoch.
 */
export function drawablePoints(sed: Sed, apertureIndex: number, filters: SedFilters): SedPoint[] {
  const drawn: SedPoint[] = []
  for (const point of sed.points) {
    if (fluxAt(point, apertureIndex) === null) continue
    if (filters.hideFlagged && point.flagged) continue
    if (!filters.detectors.has(point.detector)) continue
    if (filters.epochSlice !== null) {
      if (point.epoch_id !== filters.epochSlice) continue
    } else if (filters.hiddenEpochs.has(point.epoch_id)) {
      continue
    }
    drawn.push(point)
  }
  return drawn
}

/** How many points have `flux_mjy[a] == null`. Those points are not drawn. */
export function countWithoutPhotometry(sed: Sed, apertureIndex: number): number {
  let count = 0
  for (const point of sed.points) {
    if (fluxAt(point, apertureIndex) === null) count += 1
  }
  return count
}

/**
 * Wavelength domain: min..max of `channels[*].lambda_um`, each end padded by
 * half that channel's bandwidth. A null bandwidth adds no pad.
 */
export function lambdaDomain(channels: readonly ChannelRow[]): [number, number] {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const channel of channels) {
    const half = channel.bandwidth_um === null ? 0 : channel.bandwidth_um / 2
    const lo = channel.lambda_um - half
    const hi = channel.lambda_um + half
    if (lo < min) min = lo
    if (hi > max) max = hi
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0.1, 5]
  if (!(max > min)) return [min, min + 1]
  return [min, max]
}

function channelById(channels: readonly ChannelRow[], id: number): ChannelRow | undefined {
  for (const channel of channels) {
    if (channel.channel === id) return channel
  }
  return undefined
}

/** Left edge of a channel. A null bandwidth uses the midpoint to the previous channel. */
function lowerEdge(channel: ChannelRow, previous: ChannelRow | undefined): number {
  if (channel.bandwidth_um !== null) return channel.lambda_um - channel.bandwidth_um / 2
  if (previous) return (previous.lambda_um + channel.lambda_um) / 2
  return channel.lambda_um
}

/** Right edge of a channel. A null bandwidth uses the midpoint to the next channel. */
function upperEdge(channel: ChannelRow, next: ChannelRow | undefined): number {
  if (channel.bandwidth_um !== null) return channel.lambda_um + channel.bandwidth_um / 2
  if (next) return (channel.lambda_um + next.lambda_um) / 2
  return channel.lambda_um
}

/**
 * Dichroic gap from the left edge of channel 50 to the right edge of channel 51.
 * A null `bandwidth_um` uses the midpoint to the adjacent channel.
 */
export function dichroicBand(channels: readonly ChannelRow[]): DichroicBand | null {
  const low = channelById(channels, 50)
  const high = channelById(channels, 51)
  if (!low || !high) return null
  return {
    startUm: lowerEdge(low, channelById(channels, 49)),
    endUm: upperEdge(high, channelById(channels, 52)),
  }
}

/** Odd transform `asinh(v / s)`. `s <= 0` falls back to 1. */
export function signedAsinh(v: number, s: number): number {
  const scale = s > 0 && Number.isFinite(s) ? s : 1
  return Math.asinh(v / scale)
}

/**
 * Softening for the signed-asinh flux axis: the median of `|flux|` over the
 * drawn points. Empty, non-finite, or zero medians fall back to 1.
 */
export function asinhScale(values: readonly number[]): number {
  const magnitudes: number[] = []
  for (const value of values) {
    if (Number.isFinite(value)) magnitudes.push(Math.abs(value))
  }
  const mid = median(magnitudes)
  if (mid === undefined || !Number.isFinite(mid) || mid === 0) return 1
  return mid
}

/**
 * Compressed time axis. Segments follow `epoch_id` order. Length is proportional
 * to `max(mjd_end - mjd_start, minSpanDays)`, with a fixed `gapPx` between them.
 * Within a segment, `x = x0 + (mjd - mjd_start) * (width / spanDays)`.
 */
export function buildCompressedAxis(
  epochs: readonly Epoch[],
  widthPx: number,
  minSpanDays = EPOCH_MIN_SPAN_DAYS,
  gapPx = EPOCH_GAP_PX,
): CompressedAxis {
  const ordered = [...epochs].sort((a, b) => a.epoch_id - b.epoch_id)
  const weights = ordered.map((epoch) => Math.max(epoch.mjd_end - epoch.mjd_start, minSpanDays))
  const gapCount = ordered.length > 1 ? ordered.length - 1 : 0
  const usable = Math.max(0, widthPx - gapCount * gapPx)
  let total = 0
  for (const weight of weights) total += weight
  const pxPerDay = total > 0 ? usable / total : 0
  const segments: TimeSegment[] = []
  let cursor = 0
  for (let index = 0; index < ordered.length; index += 1) {
    const epoch = ordered[index]
    const weight = weights[index]
    if (!epoch || weight === undefined) continue
    const x0 = cursor
    const x1 = cursor + weight * pxPerDay
    segments.push({
      epochId: epoch.epoch_id,
      mjdStart: epoch.mjd_start,
      mjdEnd: epoch.mjd_end,
      spanDays: weight,
      x0,
      x1,
    })
    cursor = x1 + gapPx
  }
  const byId = new Map<number, TimeSegment>()
  for (const segment of segments) byId.set(segment.epochId, segment)
  const breaks: number[] = []
  for (let index = 0; index < segments.length - 1; index += 1) {
    const left = segments[index]
    const right = segments[index + 1]
    if (!left || !right) continue
    breaks.push((left.x1 + right.x0) / 2)
  }
  const mjdToX = (epochId: number, mjd: number): number => {
    const segment = byId.get(epochId)
    if (!segment || !(segment.spanDays > 0)) return Number.NaN
    const scale = (segment.x1 - segment.x0) / segment.spanDays
    return segment.x0 + (mjd - segment.mjdStart) * scale
  }
  return { segments, breaks, mjdToX }
}

/** Linear MJD axis across the epoch envelope, with one shaded band per epoch. */
export function buildTrueAxis(epochs: readonly Epoch[], widthPx: number): TrueAxis {
  const ordered = [...epochs].sort((a, b) => a.epoch_id - b.epoch_id)
  let min = ordered[0]?.mjd_start ?? 0
  let max = ordered[0]?.mjd_end ?? min
  for (const epoch of ordered) {
    if (epoch.mjd_start < min) min = epoch.mjd_start
    if (epoch.mjd_end > max) max = epoch.mjd_end
  }
  const span = max - min
  const mjdToX = (mjd: number): number => {
    if (!(span > 0) || !(widthPx > 0)) return 0
    return ((mjd - min) / span) * widthPx
  }
  return {
    mjdToX,
    bands: ordered.map((epoch) => ({
      epochId: epoch.epoch_id,
      mjdStart: epoch.mjd_start,
      mjdEnd: epoch.mjd_end,
      x0: mjdToX(epoch.mjd_start),
      x1: mjdToX(epoch.mjd_end),
    })),
  }
}

/**
 * Points inside the Blink wavelength window. `k` uses each point's own bandwidth.
 */
export function bandMembers(points: readonly SedPoint[], lambda0: number, k: number): SedPoint[] {
  const members: SedPoint[] = []
  for (const point of points) {
    if (inWindow(point, lambda0, k)) members.push(point)
  }
  return members
}

/** Screen size of one lambda-time cell. Width is fixed; height is at least `LT_MIN_CELL_PX`. */
export function lambdaTimeCellPx(bandwidthUm: number, pxPerUm: number): { widthPx: number; heightPx: number } {
  const scaled = Math.abs(bandwidthUm) * Math.abs(pxPerUm)
  return {
    widthPx: LT_CELL_WIDTH_PX,
    heightPx: scaled < LT_MIN_CELL_PX ? LT_MIN_CELL_PX : scaled,
  }
}

const CSV_HEADER =
  'frame_index,epoch_id,detector,channel,mjd,obs_time_utc,lambda_um,bandwidth_um,flux_mjy,flux_err_mjy,flagged'

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`
  return value
}

function csvNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return ''
  return String(value)
}

/** Visible points for the selected aperture. Null measurements are empty fields. */
export function toCsv(points: readonly SedPoint[], apertureIndex: number): string {
  const lines = [CSV_HEADER]
  for (const point of points) {
    const fields = [
      String(point.frame_index),
      String(point.epoch_id),
      String(point.detector),
      String(point.channel),
      csvNumber(point.mjd),
      csvField(point.obs_time_utc),
      csvNumber(point.lambda_um),
      csvNumber(point.bandwidth_um),
      csvNumber(fluxAt(point, apertureIndex)),
      csvNumber(fluxErrAt(point, apertureIndex)),
      point.flagged ? 'true' : 'false',
    ]
    lines.push(fields.join(','))
  }
  return lines.join('\n')
}
