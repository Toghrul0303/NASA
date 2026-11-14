import { describe, expect, it } from 'vitest'
import { ZOOM_MAX, ZOOM_MIN } from '../../src/config/constants'
import {
  anchorZoom,
  clampZoom,
  floorFitBase,
  imagePixelAt,
  placeView,
  scaleBar,
  wheelZoomFactor,
  zoomAbout,
  type ViewportSize,
} from '../../src/lab/viewport'

const box: ViewportSize = { cssW: 400, cssH: 300, imageW: 30, imageH: 30 }

describe('floor-fit and zoom', () => {
  it('floor-fits the container at an integer scale of at least 1', () => {
    expect(floorFitBase(box)).toBe(10)
    expect(floorFitBase({ cssW: 20, cssH: 20, imageW: 30, imageH: 30 })).toBe(1)
    expect(floorFitBase({ cssW: 0, cssH: 100, imageW: 30, imageH: 30 })).toBe(1)
  })

  it('clamps user zoom to the configured range', () => {
    expect(clampZoom(0.2)).toBe(ZOOM_MIN)
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(40)).toBe(ZOOM_MAX)
    expect(clampZoom(Number.NaN)).toBe(ZOOM_MIN)
  })

  it('centers the image when pan is zero', () => {
    const placed = placeView(box, 1, 0, 0)
    expect(placed.base).toBe(10)
    expect(placed.scale).toBe(10)
    expect(placed.originX).toBe(50)
    expect(placed.originY).toBe(0)
    expect(placed.panX).toBe(0)
    expect(placed.panY).toBe(0)
  })
})

describe('zoom about the cursor', () => {
  it('keeps the image point under the cursor', () => {
    const next = zoomAbout(box, 1, 0, 0, 100, 40, 2)
    expect(next.zoom).toBe(2)
    expect(next.panX).toBeCloseTo(100, 8)
    expect(next.panY).toBeCloseTo(110, 8)
    const placed = placeView(box, next.zoom, next.panX, next.panY)
    expect(placed.originX + 5 * placed.scale).toBeCloseTo(100, 8)
    expect(placed.originY + 4 * placed.scale).toBeCloseTo(40, 8)
  })

  it('pins a pinch anchor to the moving midpoint', () => {
    const next = anchorZoom(box, 5, 4, 80, 20, 2)
    const placed = placeView(box, next.zoom, next.panX, next.panY)
    expect(placed.originX + 5 * placed.scale).toBeCloseTo(80, 6)
    expect(placed.originY + 4 * placed.scale).toBeCloseTo(20, 6)
  })

  it('zooms out for a positive wheel delta', () => {
    expect(wheelZoomFactor(100, 0)).toBeLessThan(1)
    expect(wheelZoomFactor(-100, 0)).toBeGreaterThan(1)
  })
})

describe('pan clamp', () => {
  it('keeps part of a zoomed image inside the viewport', () => {
    const placed = placeView(box, 4, 100000, -100000)
    expect(placed.originX).toBeLessThan(box.cssW)
    expect(placed.originX + placed.contentW).toBeGreaterThan(0)
    expect(placed.originY).toBeLessThan(box.cssH)
    expect(placed.originY + placed.contentH).toBeGreaterThan(0)
    expect(Math.min(box.cssW, placed.originX + placed.contentW) - Math.max(0, placed.originX)).toBeGreaterThanOrEqual(
      48,
    )
  })
})

describe('pixel hit test', () => {
  it('maps the centered image origin to canvas pixel (0, 0), which is binary north', () => {
    const placed = placeView(box, 1, 0, 0)
    const hit = imagePixelAt(placed, placed.originX + 0.5, placed.originY + 0.5)
    expect(hit).toEqual({ col: 0, row: 0 })
    expect(hit && box.imageH - 1 - hit.row).toBe(29)
  })

  it('returns null outside the image', () => {
    const placed = placeView(box, 1, 0, 0)
    expect(imagePixelAt(placed, 0, 0)).toBeNull()
  })
})

describe('scale bar', () => {
  it('uses a 1 arcmin bar at the default floor-fit of the fixture scale', () => {
    const bar = scaleBar(10, 6.15, 400)
    expect(bar).not.toBeNull()
    expect(bar?.arcsec).toBe(60)
    expect(bar?.label).toBe('1 arcmin')
  })

  it('shortens to a few arcsec when zoomed in', () => {
    const bar = scaleBar(80, 6.15, 400)
    expect(bar?.label).toBe('5 arcsec')
    expect(bar?.arcsec).toBe(5)
  })
})
