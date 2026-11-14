/**
 * Gate G1 HiPS cube probe. FRONTEND_SPEC §8.4.
 *
 * The build flag defaults to false. The Cube control is shown only after `probe()`
 * loads `VITE_SPHEREX_CUBE_HIPS_URL` and confirms a slice change. Slice 62 is the
 * probe target. Dichroic channels 50 and 51 are never requested. A failed or timed-out
 * probe leaves the control off and writes a `[map]` log line, with nothing shown in the UI.
 * This module does not import Aladin; the adapter is the only importer.
 */
import type { MapAdapter } from './aladinAdapter'
import { env } from '../config/env'

export const CHANNEL_MIN = 0
export const CHANNEL_MAX = 101
export const DICHROIC_CHANNELS = [50, 51] as const
/** Non-dichroic frame used to prove the cube can change slice. Band 4, band channel 12. */
export const CUBE_PROBE_SLICE = 62
export const CUBE_PROBE_TIMEOUT_MS = 10_000

const CUBE_DISABLED = '[map] Cube control disabled'

const VALID_CHANNELS: readonly number[] = Array.from(
  { length: CHANNEL_MAX - CHANNEL_MIN + 1 },
  (_, index) => index,
).filter((channel) => channel !== DICHROIC_CHANNELS[0] && channel !== DICHROIC_CHANNELS[1])

export function isDichroicChannel(channel: number): boolean {
  return channel === DICHROIC_CHANNELS[0] || channel === DICHROIC_CHANNELS[1]
}

/** Slider values. Channels 50 and 51 are omitted so the control steps over the dichroic gap. */
export function validChannels(): readonly number[] {
  return VALID_CHANNELS
}

/** `channel = 17 * (band - 1) + (band_channel - 1)` (DC §3.3). */
export function bandAndChannel(channel: number): { band: number; bandChannel: number } {
  return {
    band: Math.floor(channel / 17) + 1,
    bandChannel: (channel % 17) + 1,
  }
}

/**
 * Move to the next channel the slider can select.
 * Crossing 50 or 51 reports `crossedDichroic` so the keyboard path can show the empty-channel note.
 */
export function stepValidChannel(channel: number, direction: 1 | -1): { channel: number; crossedDichroic: boolean } {
  let crossedDichroic = false
  let next = channel
  for (;;) {
    next += direction
    if (next < CHANNEL_MIN || next > CHANNEL_MAX) return { channel, crossedDichroic }
    if (isDichroicChannel(next)) {
      crossedDichroic = true
      continue
    }
    return { channel: next, crossedDichroic }
  }
}

export type ChannelResolution = { ok: true; channel: number } | { ok: false; dichroic: boolean }

/** Typed channel entry. 50 and 51 resolve as dichroic and are not selected. */
export function resolveChannelInput(channel: number): ChannelResolution {
  if (!Number.isInteger(channel) || channel < CHANNEL_MIN || channel > CHANNEL_MAX) {
    return { ok: false, dichroic: false }
  }
  if (isDichroicChannel(channel)) return { ok: false, dichroic: true }
  return { ok: true, channel }
}

/** Last valid channel before the probe slice, skipping the dichroic gap. */
export function probeBaselineChannel(target: number = CUBE_PROBE_SLICE): number {
  for (let channel = target - 1; channel >= CHANNEL_MIN; channel -= 1) {
    if (!isDichroicChannel(channel)) return channel
  }
  for (let channel = target + 1; channel <= CHANNEL_MAX; channel += 1) {
    if (!isDichroicChannel(channel)) return channel
  }
  return target
}

export interface CubeProbeOptions {
  /** Defaults to `VITE_FEATURE_G1_CUBE`. */
  enabled?: boolean
  /** Defaults to `VITE_SPHEREX_CUBE_HIPS_URL` when the property is omitted. */
  url?: string
  timeoutMs?: number
}

/**
 * Run the Gate G1 probe once.
 * Returns true only when the cube loads and a switch onto slice 62 finishes in time.
 * The base survey is restored either way. False means the Cube control stays off.
 */
export async function probe(adapter: MapAdapter, options?: CubeProbeOptions): Promise<boolean> {
  const enabled = options?.enabled ?? env.featureG1Cube
  if (!enabled) return false

  const url = options && 'url' in options ? options.url : env.spherexCubeHipsUrl
  if (!url) {
    console.info(CUBE_DISABLED)
    return false
  }

  const baseline = probeBaselineChannel(CUBE_PROBE_SLICE)
  if (isDichroicChannel(baseline) || isDichroicChannel(CUBE_PROBE_SLICE)) {
    console.info(CUBE_DISABLED)
    return false
  }

  const timeoutMs = options?.timeoutMs ?? CUBE_PROBE_TIMEOUT_MS
  let obsolete = false
  let failure: unknown
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      obsolete = true
      resolve(false)
    }, timeoutMs)
  })

  const attempt = (async (): Promise<boolean> => {
    await adapter.setCube({ url, channel: baseline })
    if (obsolete) return false
    await adapter.setCube({ url, channel: CUBE_PROBE_SLICE })
    if (obsolete) return false
    return true
  })().catch((error: unknown) => {
    failure = error
    return false
  })

  const switched = await Promise.race([attempt, timeout])
  if (timer !== undefined) clearTimeout(timer)
  obsolete = true

  try {
    await adapter.setCube(null)
  } catch (error: unknown) {
    console.info(CUBE_DISABLED, error)
    return false
  }

  if (!switched) {
    if (failure === undefined) console.info(CUBE_DISABLED)
    else console.info(CUBE_DISABLED, failure)
    return false
  }
  return true
}
