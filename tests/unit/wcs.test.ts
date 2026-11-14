import { describe, expect, it } from 'vitest'
import { gridToOverlay, pixelToWorld, propagate, worldToPixel, yearOfMjd, type Grid } from '../../src/core/wcs'

const SCALE_DEG = 6.15 / 3600

function gridAt(ra: number, dec: number, width = 60, height = 60): Grid {
  return {
    crval1_deg: ra,
    crval2_deg: dec,
    crpix1: width / 2 + 0.5,
    crpix2: height / 2 + 0.5,
    cdelt1_deg: -SCALE_DEG,
    cdelt2_deg: SCALE_DEG,
    width,
    height,
  }
}

function raDelta(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360
  return Math.min(raw, 360 - raw)
}

function expectRoundTrip(grid: Grid, ra: number, dec: number): void {
  const pixel = worldToPixel(ra, dec, grid)
  expect(pixel).not.toBeNull()
  if (!pixel) return
  const world = pixelToWorld(pixel.x, pixel.y, grid)
  expect(raDelta(ra, world.ra)).toBeLessThan(1e-9)
  expect(Math.abs(dec - world.dec)).toBeLessThan(1e-9)
}

describe('worldToPixel', () => {
  it('maps the grid centre to (W/2 - 0.5, H/2 - 0.5)', () => {
    const width = 30
    const height = 30
    const grid = gridAt(269.452, 4.693, width, height)
    const pixel = worldToPixel(grid.crval1_deg, grid.crval2_deg, grid)
    expect(pixel).toEqual({ x: width / 2 - 0.5, y: height / 2 - 0.5 })
  })

  it('places a point east of centre (larger RA) at a lower x', () => {
    const grid = gridAt(120, 10)
    const centre = worldToPixel(120, 10, grid)
    const east = worldToPixel(120.02, 10, grid)
    expect(centre).not.toBeNull()
    expect(east).not.toBeNull()
    if (!centre || !east) return
    expect(east.x).toBeLessThan(centre.x)
  })

  it('returns null for the antipode', () => {
    const grid = gridAt(40, 15)
    expect(worldToPixel(220, -15, grid)).toBeNull()
  })
})

describe('pixelToWorld round trip', () => {
  it('recovers several points to 1e-9 deg, including a wrap and a high declination', () => {
    const equatorial = gridAt(180, -20)
    for (const [ra, dec] of [
      [180, -20],
      [180.03, -19.98],
      [179.97, -20.02],
      [180.01, -20.015],
    ] as const) {
      expectRoundTrip(equatorial, ra, dec)
    }

    const wrapped = gridAt(359.99, 12)
    for (const [ra, dec] of [
      [359.99, 12],
      [359.995, 12.01],
      [0.004, 11.99],
      [359.5, 12.02],
    ] as const) {
      expectRoundTrip(wrapped, ra, dec)
    }

    const polar = gridAt(200, 80)
    for (const [ra, dec] of [
      [200, 80],
      [200.04, 80.02],
      [199.96, 79.98],
      [200.01, 80.03],
    ] as const) {
      expectRoundTrip(polar, ra, dec)
    }
  })

  it('returns the centre when rho is 0 and wraps that right ascension', () => {
    const grid = gridAt(359.99, 80, 30, 30)
    const world = pixelToWorld(grid.width / 2 - 0.5, grid.height / 2 - 0.5, grid)
    expect(world.ra).toBeCloseTo(359.99, 12)
    expect(world.dec).toBeCloseTo(80, 12)
    expect(world.ra).toBeGreaterThanOrEqual(0)
    expect(world.ra).toBeLessThan(360)
  })
})

describe('propagate', () => {
  it('is the identity when proper motion is null', () => {
    const source = { ra0: 12.5, dec0: -40.25, pmra: null, pmdec: null, refYear: 2016 }
    expect(propagate(source, 60000)).toEqual({ ra: 12.5, dec: -40.25 })
  })

  it('applies mas/yr over Julian years from J2000', () => {
    expect(yearOfMjd(51544.5)).toBe(2000)
    const moved = propagate(
      { ra0: 10, dec0: 0, pmra: 3.6e6, pmdec: 3.6e6, refYear: 2000 },
      51544.5 + 365.25,
    )
    expect(moved.ra).toBeCloseTo(11, 10)
    expect(moved.dec).toBeCloseTo(1, 10)
  })
})

describe('gridToOverlay', () => {
  it('maps the grid centre to the canvas centre', () => {
    const width = 30
    const height = 30
    expect(gridToOverlay(width / 2 - 0.5, height / 2 - 0.5, height)).toEqual({ u: width / 2, v: height / 2 })
  })
})
