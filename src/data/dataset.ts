/**
 * In-memory dataset and the indexes built once at load. FRONTEND_SPEC §4.1, §15.3.
 */
import { ContractError } from '../contract/validate'
import type { Coadd, Coadds, Detector, Epoch, Frame, Frames, Gaia, Meta, Sed, SedPoint } from '../contract/types'
import type { BinaryReader } from '../core/binary'

/** Okabe-Ito palette. Epoch `e` uses index `e mod 8`. FRONTEND_SPEC §15.3. */
export const EPOCH_PALETTE = [
  '#E69F00',
  '#56B4E9',
  '#009E73',
  '#F0E442',
  '#0072B2',
  '#D55E00',
  '#CC79A7',
  '#999999',
] as const

const DETECTORS = [1, 2, 3, 4, 5, 6] as const satisfies readonly Detector[]

export interface DatasetPreviews {
  thumb: string
  /** Null when Detector RGB is disabled. */
  rgb_detector: string | null
  rgb_equal_channel: string
}

export interface FramesByDetector {
  readonly 1: readonly Frame[]
  readonly 2: readonly Frame[]
  readonly 3: readonly Frame[]
  readonly 4: readonly Frame[]
  readonly 5: readonly Frame[]
  readonly 6: readonly Frame[]
}

export interface DatasetIndexes {
  /** Frames for detectors 1..6, each sorted by MJD. */
  framesByDetector: FramesByDetector
  epochById: ReadonlyMap<number, Epoch>
  frameByKey: ReadonlyMap<string, Frame>
  /** Keys `ed:{epoch}:{det}`, `d:{det}`, and `c:{channel}`. */
  coaddByKey: ReadonlyMap<string, Coadd>
  /** One point per frame index. `sedByFrame[frame.index]` belongs to that frame. */
  sedByFrame: readonly SedPoint[]
  /** `epochColor[epoch_id]` from the Okabe-Ito palette, cycling every 8 epochs. */
  epochColor: readonly string[]
}

export interface Dataset extends DatasetIndexes {
  meta: Meta
  frames: Frames
  coadds: Coadds
  sed: Sed
  gaia: Gaia
  frameBuf: ArrayBuffer
  coaddBuf: ArrayBuffer
  framesReader: BinaryReader
  coaddsReader: BinaryReader
  previews: DatasetPreviews
}

/** `{dataBase}/data/{slug}/{name}`, with `?v=` when a data version is given. */
export function dataFileUrl(dataBase: string, slug: string, name: string, version?: string): string {
  const root = dataBase.endsWith('/') ? dataBase.slice(0, -1) : dataBase
  const url = `${root}/data/${slug}/${name}`
  if (version === undefined) return url
  return `${url}?v=${encodeURIComponent(version)}`
}

/** Preview URLs. A null path stays null. Others gain `?v=`. */
export function previewUrls(dataBase: string, meta: Meta): DatasetPreviews {
  const version = meta.data_version
  const rgbDetector = meta.previews.rgb_detector
  return {
    thumb: dataFileUrl(dataBase, meta.slug, meta.previews.thumb, version),
    rgb_detector: rgbDetector === null ? null : dataFileUrl(dataBase, meta.slug, rgbDetector, version),
    rgb_equal_channel: dataFileUrl(dataBase, meta.slug, meta.previews.rgb_equal_channel, version),
  }
}

/** Parse JSON from the same bytes that were hashed. Unknown fields are left in place. */
export function parseJsonBytes(bytes: ArrayBuffer, label: string): unknown {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new ContractError('invalid', `${label} is not valid UTF-8`)
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ContractError('invalid', `${label} is not valid JSON`)
  }
}

function isDetector(value: number): value is Detector {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6
}

function epochPaletteColor(epochId: number): string {
  const index = ((epochId % EPOCH_PALETTE.length) + EPOCH_PALETTE.length) % EPOCH_PALETTE.length
  const color = EPOCH_PALETTE[index]
  if (color === undefined) {
    throw new ContractError('invalid', 'epoch palette lookup failed')
  }
  return color
}

function coaddKey(coadd: Coadd): string {
  const scope: string = coadd.scope
  if (scope === 'epoch_detector') {
    if (coadd.epoch_id === null || coadd.detector === null) {
      throw new ContractError('integrity_failed', 'epoch-detector coadd is missing epoch_id or detector')
    }
    return `ed:${coadd.epoch_id}:${coadd.detector}`
  }
  if (scope === 'detector') {
    if (coadd.detector === null) {
      throw new ContractError('integrity_failed', 'detector coadd is missing detector')
    }
    return `d:${coadd.detector}`
  }
  if (scope === 'channel') {
    if (coadd.channel === null) {
      throw new ContractError('integrity_failed', 'channel coadd is missing channel')
    }
    return `c:${coadd.channel}`
  }
  throw new ContractError('integrity_failed', 'coadd scope is not recognized')
}

/** Indexes derived once from the validated JSON. The input arrays are not reordered. */
export function buildIndexes(frames: Frames, coadds: Coadds, sed: Sed): DatasetIndexes {
  const grouped: Record<Detector, Frame[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
  for (const frame of frames.frames) {
    if (!isDetector(frame.detector)) {
      throw new ContractError('integrity_failed', 'frame detector is out of range')
    }
    grouped[frame.detector].push(frame)
  }

  for (const detector of DETECTORS) {
    grouped[detector].sort((a, b) => a.mjd - b.mjd || a.index - b.index)
  }
  const framesByDetector: FramesByDetector = {
    1: grouped[1],
    2: grouped[2],
    3: grouped[3],
    4: grouped[4],
    5: grouped[5],
    6: grouped[6],
  }

  const epochById = new Map<number, Epoch>()
  const epochColor: string[] = []
  for (const epoch of frames.epochs) {
    if (epochById.has(epoch.epoch_id)) {
      throw new ContractError('integrity_failed', 'epochs repeat an epoch_id')
    }
    epochById.set(epoch.epoch_id, epoch)
    epochColor[epoch.epoch_id] = epochPaletteColor(epoch.epoch_id)
  }

  const frameByKey = new Map<string, Frame>()
  for (const frame of frames.frames) {
    if (frameByKey.has(frame.frame_key)) {
      throw new ContractError('integrity_failed', 'frames repeat a frame_key')
    }
    frameByKey.set(frame.frame_key, frame)
  }

  const coaddByKey = new Map<string, Coadd>()
  for (const coadd of coadds.coadds) {
    const key = coaddKey(coadd)
    if (coaddByKey.has(key)) {
      throw new ContractError('integrity_failed', 'coadds repeat a key')
    }
    coaddByKey.set(key, coadd)
  }

  const byIndex: Array<SedPoint | undefined> = new Array(frames.n_frames)
  for (const point of sed.points) {
    if (!Number.isInteger(point.frame_index) || point.frame_index < 0 || point.frame_index >= frames.n_frames) {
      throw new ContractError('integrity_failed', 'sed point frame_index is out of range')
    }
    if (byIndex[point.frame_index] !== undefined) {
      throw new ContractError('integrity_failed', 'sed points repeat a frame_index')
    }
    byIndex[point.frame_index] = point
  }

  const sedByFrame: SedPoint[] = []
  for (let index = 0; index < frames.n_frames; index += 1) {
    const point = byIndex[index]
    if (point === undefined) {
      throw new ContractError('integrity_failed', 'sed points are not aligned to frames')
    }
    sedByFrame.push(point)
  }

  return { framesByDetector, epochById, frameByKey, coaddByKey, sedByFrame, epochColor }
}
