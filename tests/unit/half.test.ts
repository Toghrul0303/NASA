import { describe, expect, it } from 'vitest'
import { ContractError } from '../../src/contract/validate'
import { halfToFloat } from '../../src/core/half'

/** DATA_CONTRACT §10.3: 16 bytes, eight little-endian uint16 values. */
const VECTOR_BYTES = [0x00, 0x3c, 0x00, 0xbc, 0x00, 0x7e, 0xff, 0x7b, 0xff, 0xfb, 0x00, 0x00, 0x00, 0x38, 0x00, 0x40]

function decodeVector(): number[] {
  const bytes = Uint8Array.from(VECTOR_BYTES)
  const view = new DataView(bytes.buffer)
  const decoded: number[] = []
  for (let i = 0; i < 8; i += 1) {
    decoded.push(halfToFloat(view.getUint16(i * 2, true)))
  }
  return decoded
}

describe('halfToFloat', () => {
  it('decodes the DATA_CONTRACT §10.3 vector', () => {
    const decoded = decodeVector()
    const expected = [1, -1, Number.NaN, 65504, -65504, 0, 0.5, 2]
    expect(decoded).toHaveLength(expected.length)
    for (let i = 0; i < expected.length; i += 1) {
      const want = expected[i]
      const got = decoded[i]
      expect(want).toBeDefined()
      expect(got).toBeDefined()
      if (want === undefined || got === undefined) continue
      if (Number.isNaN(want)) expect(Number.isNaN(got)).toBe(true)
      else expect(got).toBe(want)
    }
    expect(Object.is(decoded[5], 0)).toBe(true)
  })

  it('decodes a subnormal and keeps -0', () => {
    expect(halfToFloat(0x0001)).toBe(2 ** -24)
    expect(Object.is(halfToFloat(0x8000), -0)).toBe(true)
  })

  it('treats an all-ones exponent with a non-zero mantissa as NaN', () => {
    expect(Number.isNaN(halfToFloat(0x7c01))).toBe(true)
    expect(Number.isNaN(halfToFloat(0xffff))).toBe(true)
    expect(halfToFloat(0x7c00)).toBe(Number.POSITIVE_INFINITY)
  })

  it('rejects a bit pattern outside the lookup table', () => {
    expect(() => halfToFloat(-1)).toThrow(ContractError)
    try {
      halfToFloat(-1)
    } catch (error) {
      expect(error).toBeInstanceOf(ContractError)
      if (error instanceof ContractError) expect(error.code).toBe('invalid')
    }
  })
})
