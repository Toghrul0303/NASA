import { describe, expect, it } from 'vitest'
import { ASINH_SOFTENING } from '../../src/config/constants'
import { asinhValue, computeLimits, percentile, renderGrayscale } from '../../src/core/stretch'

const MASK = [0x2b, 0x2f, 0x3a] as const

describe('percentile', () => {
  it('interpolates between order statistics and ignores non-finite values', () => {
    const values = new Float32Array([10, 0, 30, Number.NaN, 20, Number.POSITIVE_INFINITY])
    expect(percentile(values, 0)).toBe(0)
    expect(percentile(values, 25)).toBe(7.5)
    expect(percentile(values, 50)).toBe(15)
    expect(percentile(values, 100)).toBe(30)
    expect(Array.from(values)).toEqual([10, 0, 30, Number.NaN, 20, Number.POSITIVE_INFINITY])
  })

  it('returns NaN for an empty finite set', () => {
    expect(percentile(new Float32Array(), 50)).toBeNaN()
    expect(percentile(new Float32Array([Number.NaN]), 99.5)).toBeNaN()
  })

  it('unions planes before taking the blink-set percentiles', () => {
    const limits = computeLimits([new Float32Array([0, 10, Number.NaN]), new Float32Array([20, 30])], 0, 100)
    expect(limits).toEqual({ lo: 0, hi: 30 })
  })
})

describe('asinhValue', () => {
  it('is 0 at the low end and 1 at the high end', () => {
    expect(asinhValue(2, 2, 9, ASINH_SOFTENING)).toBe(0)
    expect(asinhValue(9, 2, 9, ASINH_SOFTENING)).toBeCloseTo(1, 12)
  })

  it('returns 0 for every value when hi <= lo', () => {
    expect(asinhValue(4, 5, 5, ASINH_SOFTENING)).toBe(0)
    expect(asinhValue(1, 8, 3, ASINH_SOFTENING)).toBe(0)
    const plane = new Float32Array([5, 6, 7])
    const out = new Uint8ClampedArray(plane.length * 4)
    renderGrayscale(plane, 5, 4, ASINH_SOFTENING, MASK, out)
    for (let i = 0; i < plane.length; i += 1) {
      expect(out[i * 4]).toBe(0)
      expect(out[i * 4 + 1]).toBe(0)
      expect(out[i * 4 + 2]).toBe(0)
      expect(out[i * 4 + 3]).toBe(255)
    }
  })
})

describe('renderGrayscale', () => {
  it('paints NaN pixels with the mask colour', () => {
    const plane = new Float32Array([2, Number.NaN, 9])
    const out = new Uint8ClampedArray(plane.length * 4)
    renderGrayscale(plane, 2, 9, ASINH_SOFTENING, MASK, out)
    expect([out[0], out[1], out[2], out[3]]).toEqual([0, 0, 0, 255])
    expect([out[4], out[5], out[6], out[7]]).toEqual([0x2b, 0x2f, 0x3a, 255])
    expect([out[8], out[9], out[10], out[11]]).toEqual([255, 255, 255, 255])
  })
})
