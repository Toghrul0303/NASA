import { describe, expect, it } from 'vitest'
import { ContractError } from '../../src/contract/validate'
import { createBinaryReader, elementIndex, toCanvasOrder } from '../../src/core/binary'
import { halfToFloat } from '../../src/core/half'

function thrown(run: () => void): ContractError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(ContractError)
    if (!(error instanceof ContractError)) throw error
    return error
  }
  throw new Error('expected ContractError')
}

describe('elementIndex', () => {
  it('addresses a known element in a hand-built buffer', () => {
    const H = 4
    const W = 5
    const nItems = 2
    const f = 1
    const p = 1
    const y = 2
    const x = 3
    const index = elementIndex(f, p, y, x, H, W)
    expect(index).toBe(((f * 2 + p) * H + y) * W + x)

    const words = new Uint16Array(nItems * 2 * H * W)
    words[index] = 0x4000
    words[index - 1] = 0x3c00
    const buf = words.buffer
    const reader = createBinaryReader({
      buf,
      nItems,
      H,
      W,
      expectedBytes: buf.byteLength,
    })

    expect(reader.u16[index]).toBe(0x4000)
    expect(halfToFloat(reader.u16[index] ?? 0)).toBe(2)
    const plane = reader.getPlane(f, p)
    expect(plane).toHaveLength(H * W)
    expect(plane[y * W + x]).toBe(2)
    expect(plane[y * W + x - 1]).toBe(1)
  })
})

describe('createBinaryReader', () => {
  it('rejects a byte-length mismatch with integrity_failed', () => {
    const longer = new ArrayBuffer(8)
    const mismatch = thrown(() =>
      createBinaryReader({ buf: longer, nItems: 1, H: 1, W: 1, expectedBytes: 8 }),
    )
    expect(mismatch.code).toBe('integrity_failed')

    const exact = new ArrayBuffer(4)
    const declared = thrown(() =>
      createBinaryReader({ buf: exact, nItems: 1, H: 1, W: 1, expectedBytes: 2 }),
    )
    expect(declared.code).toBe('integrity_failed')
  })

  it('accepts a zero-length buffer when the declared size is zero', () => {
    const reader = createBinaryReader({
      buf: new ArrayBuffer(0),
      nItems: 0,
      H: 2,
      W: 2,
      expectedBytes: 0,
    })
    expect(reader.u16).toHaveLength(0)
  })

  it('returns the same cached plane instance for a repeated request', () => {
    const H = 2
    const W = 2
    const words = new Uint16Array(1 * 2 * H * W)
    words[0] = 0x3c00
    const reader = createBinaryReader({
      buf: words.buffer,
      nItems: 1,
      H,
      W,
      expectedBytes: words.byteLength,
    })
    const first = reader.getPlane(0, 0)
    const second = reader.getPlane(0, 0)
    expect(second).toBe(first)
    expect(reader.getPlane(0, 1)).not.toBe(first)
  })
})

describe('toCanvasOrder', () => {
  it('puts the southernmost binary row at the bottom of the canvas', () => {
    const H = 4
    const W = 5
    const src = new Float32Array(H * W)
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) src[y * W + x] = y
    }
    const dst = toCanvasOrder(src, H, W)
    for (let c = 0; c < W; c += 1) {
      expect(dst[c]).toBe(H - 1)
    }
  })

  it('lands a bright pixel at binary (0, 0) on canvas column 0, row H - 1', () => {
    const H = 3
    const W = 4
    const src = new Float32Array(H * W)
    src[0] = 9
    const dst = toCanvasOrder(src, H, W)
    expect(dst[(H - 1) * W + 0]).toBe(9)
    for (let i = 0; i < dst.length; i += 1) {
      if (i === (H - 1) * W) continue
      expect(dst[i]).toBe(0)
    }
  })
})
