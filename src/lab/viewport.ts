/**
 * Frame canvas zoom, pan, and scale bar. FRONTEND_SPEC §9.4.
 * Pure geometry: no React and no DOM. User zoom multiplies the integer floor-fit.
 */
import { ZOOM_MAX, ZOOM_MIN } from '../config/constants'
import type { FrameViewport } from '../state/store'

export interface ViewportSize {
  cssW: number
  cssH: number
  imageW: number
  imageH: number
}

export interface PlacedView extends FrameViewport {
  base: number
  scale: number
  originX: number
  originY: number
  contentW: number
  contentH: number
}

/** CSS pixels of the image that must remain inside the viewport. */
const MIN_VISIBLE_CSS = 48

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom < ZOOM_MIN) return ZOOM_MIN
  if (zoom > ZOOM_MAX) return ZOOM_MAX
  return zoom
}

/** Largest integer CSS-pixels-per-image-pixel that fits. At least 1. */
export function floorFitBase(size: ViewportSize): number {
  const { cssW, cssH, imageW, imageH } = size
  if (!(cssW > 0) || !(cssH > 0) || !(imageW > 0) || !(imageH > 0)) return 1
  return Math.max(1, Math.floor(Math.min(cssW / imageW, cssH / imageH)))
}

function clampOrigin(origin: number, content: number, viewport: number): number {
  const keep = Math.min(MIN_VISIBLE_CSS, content, Math.max(viewport, 0))
  if (!(keep > 0)) return origin
  const min = keep - content
  const max = viewport - keep
  if (min > max) return (viewport - content) / 2
  if (origin < min) return min
  if (origin > max) return max
  return origin
}

/** Pan is the CSS offset from the centered floor-fit. The result stays partly on screen. */
export function placeView(size: ViewportSize, zoom: number, panX: number, panY: number): PlacedView {
  const base = floorFitBase(size)
  const clamped = clampZoom(zoom)
  const scale = base * clamped
  const contentW = size.imageW * scale
  const contentH = size.imageH * scale
  const originX = clampOrigin((size.cssW - contentW) / 2 + panX, contentW, size.cssW)
  const originY = clampOrigin((size.cssH - contentH) / 2 + panY, contentH, size.cssH)
  return {
    zoom: clamped,
    panX: originX - (size.cssW - contentW) / 2,
    panY: originY - (size.cssH - contentH) / 2,
    base,
    scale,
    originX,
    originY,
    contentW,
    contentH,
  }
}

/**
 * Zoom while keeping the image point under `(cssX, cssY)` fixed.
 * `nextZoom` is absolute, still in `ZOOM_MIN`…`ZOOM_MAX`.
 */
export function zoomAbout(
  size: ViewportSize,
  zoom: number,
  panX: number,
  panY: number,
  cssX: number,
  cssY: number,
  nextZoom: number,
): FrameViewport {
  const current = placeView(size, zoom, panX, panY)
  const ix = current.scale > 0 ? (cssX - current.originX) / current.scale : 0
  const iy = current.scale > 0 ? (cssY - current.originY) / current.scale : 0
  return anchorZoom(size, ix, iy, cssX, cssY, nextZoom)
}

/** Place image point `(ix, iy)` at the CSS point, then clamp. Used by pinch. */
export function anchorZoom(
  size: ViewportSize,
  ix: number,
  iy: number,
  cssX: number,
  cssY: number,
  zoom: number,
): FrameViewport {
  const base = floorFitBase(size)
  const target = clampZoom(zoom)
  const scale = base * target
  const originX = cssX - ix * scale
  const originY = cssY - iy * scale
  const panX = originX - (size.cssW - size.imageW * scale) / 2
  const panY = originY - (size.cssH - size.imageH * scale) / 2
  const placed = placeView(size, target, panX, panY)
  return { zoom: placed.zoom, panX: placed.panX, panY: placed.panY }
}

/**
 * Pan so the grid point `(x, y)` sits at the viewport centre, then clamp.
 * Overlay mapping is `u = x + 0.5`, `v = imageH - 0.5 - y`.
 */
export function centerOnGrid(
  size: ViewportSize,
  zoom: number,
  x: number,
  y: number,
  imageH: number,
): FrameViewport {
  const placed = placeView(size, zoom, 0, 0)
  const u = x + 0.5
  const v = imageH - 0.5 - y
  const panX = placed.scale * (size.imageW / 2 - u)
  const panY = placed.scale * (size.imageH / 2 - v)
  const next = placeView(size, zoom, panX, panY)
  return { zoom: next.zoom, panX: next.panX, panY: next.panY }
}

/** Wheel notches zoom out when `deltaY` is positive. `deltaMode` is the DOM delta mode. */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  let delta = deltaY
  if (deltaMode === 1) delta *= 16
  else if (deltaMode === 2) delta *= 400
  if (!Number.isFinite(delta)) return 1
  return Math.exp(-delta * 0.0022)
}

export interface ImagePixel {
  col: number
  row: number
}

/** Canvas-order pixel under a CSS point, or null when the point misses the image. */
export function imagePixelAt(placed: PlacedView, cssX: number, cssY: number): ImagePixel | null {
  if (!(placed.scale > 0)) return null
  const ix = (cssX - placed.originX) / placed.scale
  const iy = (cssY - placed.originY) / placed.scale
  if (ix < 0 || iy < 0 || ix >= placed.contentW / placed.scale || iy >= placed.contentH / placed.scale) return null
  const imageW = placed.contentW / placed.scale
  const imageH = placed.contentH / placed.scale
  return {
    col: Math.min(imageW - 1, Math.floor(ix)),
    row: Math.min(imageH - 1, Math.floor(iy)),
  }
}

export interface ScaleBar {
  css: number
  arcsec: number
  label: string
}

function tidy(value: number): number {
  return Number(value.toPrecision(12))
}

function niceArcsecValues(targetArcsec: number): number[] {
  const values = new Set<number>()
  const exp = Math.floor(Math.log10(Math.max(targetArcsec, 1e-6)))
  for (let e = exp - 3; e <= exp + 2; e += 1) {
    const mag = 10 ** e
    values.add(tidy(mag))
    values.add(tidy(2 * mag))
    values.add(tidy(5 * mag))
  }
  for (const extra of [15, 30, 60, 90, 120, 180, 300, 600, 900, 1200, 1800, 3600]) values.add(extra)
  return [...values].sort((a, b) => a - b)
}

function formatAngular(arcsec: number): string {
  if (arcsec >= 60) {
    const arcmin = arcsec / 60
    const text = Number.isInteger(arcmin) ? String(arcmin) : arcmin.toFixed(1)
    return `${text} arcmin`
  }
  const text = Number.isInteger(arcsec) ? String(arcsec) : arcsec.toFixed(1)
  return `${text} arcsec`
}

/**
 * A 1-2-5 (and whole-arcminute) length near a comfortable screen width.
 * Labels switch to arcmin at 60 arcsec.
 */
export function scaleBar(cssPerImagePx: number, pixelScaleArcsec: number, viewportCss: number): ScaleBar | null {
  if (!(cssPerImagePx > 0) || !(pixelScaleArcsec > 0) || !(viewportCss > 16)) return null
  const maxCss = Math.min(180, viewportCss * 0.5)
  const targetCss = Math.min(maxCss, Math.max(48, Math.min(120, viewportCss * 0.3)))
  const targetArcsec = (targetCss / cssPerImagePx) * pixelScaleArcsec
  const barCss = (arcsec: number) => (arcsec / pixelScaleArcsec) * cssPerImagePx
  const values = niceArcsecValues(targetArcsec)
  const underTarget = values.filter((arcsec) => {
    const css = barCss(arcsec)
    return css >= 24 && css <= targetCss + 0.01
  })
  const pool =
    underTarget.length > 0 ? underTarget : values.filter((arcsec) => barCss(arcsec) >= 8 && barCss(arcsec) <= maxCss)
  const arcsec = pool[pool.length - 1]
  if (arcsec === undefined) return null
  return { arcsec, css: barCss(arcsec), label: formatAngular(arcsec) }
}
