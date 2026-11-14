// @vitest-environment node

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Coadds, Frames, Gaia, Meta, Sed } from '../../src/contract/types'

const fixtureDir = fileURLToPath(new URL('../../public/data/fixture-barnard', import.meta.url))

function readBytes(name: string): Buffer {
  return readFileSync(join(fixtureDir, name))
}

function readJson(name: string): unknown {
  return JSON.parse(readBytes(name).toString('utf8')) as unknown
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1
  const exponent = (h >> 10) & 0x1f
  const mantissa = h & 0x03ff
  if (exponent === 0) return sign * 2 ** -14 * (mantissa / 1024)
  if (exponent === 0x1f) return mantissa ? Number.NaN : sign * Number.POSITIVE_INFINITY
  return sign * 2 ** (exponent - 15) * (1 + mantissa / 1024)
}

function assertNanPlanesMatch(buf: Buffer, nItems: number, height: number, width: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let nanCount = 0
  for (let item = 0; item < nItems; item += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const intensityOffset = (((item * 2 + 0) * height + y) * width + x) * 2
        const sigmaOffset = (((item * 2 + 1) * height + y) * width + x) * 2
        const intensity = halfToFloat(view.getUint16(intensityOffset, true))
        const sigma = halfToFloat(view.getUint16(sigmaOffset, true))
        expect(Number.isNaN(intensity)).toBe(Number.isNaN(sigma))
        if (Number.isNaN(intensity)) nanCount += 1
      }
    }
  }
  expect(nanCount).toBeGreaterThan(0)
}

describe('fixture-barnard integrity', () => {
  const meta = readJson('meta.json') as Meta
  const frames = readJson('frames.json') as Frames
  const coadds = readJson('coadds.json') as Coadds
  const sed = readJson('sed.json') as Sed
  const gaia = readJson('gaia.json') as Gaia

  const fileNames = ['frames.json', 'frames.bin', 'coadds.json', 'coadds.bin', 'sed.json', 'gaia.json'] as const

  it('matches meta.files byte length and sha256 for every listed file', () => {
    for (const name of fileNames) {
      const bytes = readBytes(name)
      const entry = meta.files[name]
      expect(bytes.length).toBe(entry.bytes)
      expect(sha256(bytes)).toBe(entry.sha256)
    }
  })

  it('matches binary sizes to n_items, height, width, and meta.binaries', () => {
    const framesBin = readBytes('frames.bin')
    const coaddsBin = readBytes('coadds.bin')
    const framesBytes = meta.binaries.frames.n_items * 2 * meta.binaries.frames.height * meta.binaries.frames.width * 2
    const coaddsBytes = meta.binaries.coadds.n_items * 2 * meta.binaries.coadds.height * meta.binaries.coadds.width * 2
    expect(framesBin.length).toBe(framesBytes)
    expect(framesBin.length).toBe(meta.binaries.frames.bytes)
    expect(coaddsBin.length).toBe(coaddsBytes)
    expect(coaddsBin.length).toBe(meta.binaries.coadds.bytes)
    expect(coadds.n_coadds).toBe(meta.binaries.coadds.n_items)
  })

  it('shares slug and data_version and lines up frame counts', () => {
    for (const doc of [meta, frames, coadds, sed, gaia]) {
      expect(doc.slug).toBe(meta.slug)
      expect(doc.data_version).toBe(meta.data_version)
    }
    expect(frames.n_frames).toBe(meta.observations.n_frames)
    expect(frames.n_frames).toBe(meta.binaries.frames.n_items)
    expect(frames.frames.length).toBe(frames.n_frames)
    expect(sed.n_points).toBe(frames.n_frames)
    expect(sed.points.length).toBe(sed.n_points)
  })

  it('keeps plane-0 NaNs paired with plane-1 NaNs', () => {
    assertNanPlanesMatch(
      readBytes('frames.bin'),
      meta.binaries.frames.n_items,
      meta.binaries.frames.height,
      meta.binaries.frames.width,
    )
    assertNanPlanesMatch(
      readBytes('coadds.bin'),
      meta.binaries.coadds.n_items,
      meta.binaries.coadds.height,
      meta.binaries.coadds.width,
    )
  })
})
