/**
 * Float16 decode. DATA_CONTRACT §10.1, FRONTEND_SPEC §6.3.
 * `HALF_LUT` is filled once at module load from the reference decoder.
 * An all-ones exponent with a non-zero mantissa is NaN. Subnormals use the
 * reference scale. Signed zero stays signed zero, including -0.
 */
import { ContractError } from '../contract/validate'

/** Reference `halfToFloat` from DATA_CONTRACT §10.1. Used only to fill the table. */
function referenceHalfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1
  const e = (h >> 10) & 0x1f
  const m = h & 0x03ff
  if (e === 0) return s * Math.pow(2, -14) * (m / 1024)
  if (e === 0x1f) return m ? NaN : s * Infinity
  return s * Math.pow(2, e - 15) * (1 + m / 1024)
}

/** 65,536-entry decode table. The index is the uint16 bit pattern. */
export const HALF_LUT = new Float32Array(65536)

for (let h = 0; h < HALF_LUT.length; h += 1) {
  HALF_LUT[h] = referenceHalfToFloat(h)
}

/** Decode one IEEE binary16 value. `h` is a uint16 bit pattern. */
export function halfToFloat(h: number): number {
  const decoded = HALF_LUT[h]
  if (decoded === undefined) {
    throw new ContractError('invalid', 'half-precision value is outside the lookup table')
  }
  return decoded
}
