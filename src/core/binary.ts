/**
 * Views over `frames.bin` and `coadds.bin`. FRONTEND_SPEC §6.3, §9.1.
 * Planes stay in binary order (`y = 0` southernmost) until `toCanvasOrder`,
 * which is the only vertical flip in the codebase.
 */
import { DECODE_CACHE_ITEMS } from '../config/constants'
import { ContractError } from '../contract/validate'
import { HALF_LUT } from './half'

/**
 * Host must be little-endian: the contract's uint16 values are stored
 * least-significant byte first, and `Uint16Array` reads native order.
 */
export function assertLittleEndian(): void {
  const word = new Uint16Array([1])
  const bytes = new Uint8Array(word.buffer)
  if (bytes[0] !== 1) {
    throw new ContractError('integrity_failed', 'host byte order is not little-endian')
  }
}

/** Element index in uint16 units. DATA_CONTRACT §10.1. */
export function elementIndex(f: number, p: number, y: number, x: number, H: number, W: number): number {
  return ((f * 2 + p) * H + y) * W + x
}

export interface BinaryReaderOptions {
  buf: ArrayBuffer
  nItems: number
  H: number
  W: number
  expectedBytes: number
}

export interface BinaryReader {
  /**
   * One `H * W` plane in binary order (`y = 0` southernmost), decoded with `HALF_LUT`.
   * The returned array is cached. This module never mutates a cached plane, and a
   * repeated request returns the same instance. Callers must not mutate it either.
   */
  getPlane(item: number, plane: number): Float32Array
  /** Little-endian uint16 view of `buf` at byte offset 0. */
  readonly u16: Uint16Array
}

function planeCacheKey(item: number, plane: number): string {
  return `${item}:${plane}`
}

/**
 * Rejects a buffer whose length is not `expectedBytes` or not `nItems * 2 * H * W * 2`.
 * A zero-length buffer is valid when both of those lengths are 0.
 */
export function createBinaryReader(options: BinaryReaderOptions): BinaryReader {
  const { buf, nItems, H, W, expectedBytes } = options
  const byteCount = nItems * 2 * H * W * 2
  if (buf.byteLength !== expectedBytes || buf.byteLength !== byteCount) {
    throw new ContractError(
      'integrity_failed',
      `binary length ${buf.byteLength} does not match expected ${expectedBytes} or ${byteCount}`,
    )
  }

  const u16 = new Uint16Array(buf)
  const cache = new Map<string, Float32Array>()

  function getPlane(item: number, plane: number): Float32Array {
    if (!Number.isInteger(item) || item < 0 || item >= nItems) {
      throw new ContractError('invalid', `item ${item} is out of range`)
    }
    if (plane !== 0 && plane !== 1) {
      throw new ContractError('invalid', `plane ${plane} is out of range`)
    }

    const key = planeCacheKey(item, plane)
    const cached = cache.get(key)
    if (cached !== undefined) {
      cache.delete(key)
      cache.set(key, cached)
      return cached
    }

    const out = new Float32Array(H * W)
    const base = elementIndex(item, plane, 0, 0, H, W)
    for (let i = 0; i < out.length; i += 1) {
      const word = u16[base + i]
      const decoded = word === undefined ? undefined : HALF_LUT[word]
      if (decoded === undefined) {
        throw new ContractError('integrity_failed', 'binary plane could not be decoded')
      }
      out[i] = decoded
    }

    cache.set(key, out)
    if (cache.size > DECODE_CACHE_ITEMS) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    return out
  }

  return { getPlane, u16 }
}

/**
 * Copy a binary-order plane into canvas order (row 0 at the top).
 * FRONTEND_SPEC §9.1. No other module flips vertically.
 */
export function toCanvasOrder(plane: ArrayLike<number>, H: number, W: number): Float32Array {
  const src = plane
  const dst = new Float32Array(H * W)
  for (let r = 0; r < H; r += 1) {
    const srcRow = (H - 1 - r) * W
    const dstRow = r * W
    for (let c = 0; c < W; c += 1) {
      const sample = src[srcRow + c]
      dst[dstRow + c] = sample ?? Number.NaN
    }
  }
  return dst
}
