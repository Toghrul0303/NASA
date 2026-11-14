/**
 * Canvas 2D markers for the SED view. Axes stay in SVG.
 * No React. Hit-testing is a linear scan.
 */
import type { EpochShape } from '../core/epochs'

export interface MarkerGeom {
  x: number
  y: number
  /** Horizontal error bar, wavelength half-bandwidth in pixels. */
  x0: number
  x1: number
  /** Vertical error bar. Equal to `y` when the uncertainty is absent. */
  y0: number
  y1: number
  color: string
  shape: EpochShape
  hollow: boolean
  drawXError: boolean
  drawYError: boolean
}

const MARKER_R = 4.5
const HIT_PX = 10

function traceShape(ctx: CanvasRenderingContext2D, shape: EpochShape, x: number, y: number): void {
  const r = MARKER_R
  ctx.beginPath()
  if (shape === 'circle') {
    ctx.arc(x, y, r, 0, Math.PI * 2)
    return
  }
  if (shape === 'square') {
    ctx.rect(x - r, y - r, r * 2, r * 2)
    return
  }
  if (shape === 'triangle') {
    ctx.moveTo(x, y - r)
    ctx.lineTo(x + r, y + r * 0.85)
    ctx.lineTo(x - r, y + r * 0.85)
    ctx.closePath()
    return
  }
  ctx.moveTo(x, y - r)
  ctx.lineTo(x + r, y)
  ctx.lineTo(x, y + r)
  ctx.lineTo(x - r, y)
  ctx.closePath()
}

function drawErrorBars(ctx: CanvasRenderingContext2D, marker: MarkerGeom): void {
  ctx.save()
  ctx.strokeStyle = marker.color
  ctx.lineWidth = 1
  ctx.beginPath()
  if (marker.drawXError) {
    ctx.moveTo(marker.x0, marker.y)
    ctx.lineTo(marker.x1, marker.y)
  }
  if (marker.drawYError) {
    ctx.moveTo(marker.x, marker.y0)
    ctx.lineTo(marker.x, marker.y1)
  }
  ctx.stroke()
  ctx.restore()
}

function drawMarker(ctx: CanvasRenderingContext2D, marker: MarkerGeom, highlight: boolean): void {
  if (highlight) {
    ctx.beginPath()
    ctx.arc(marker.x, marker.y, MARKER_R + 3.5, 0, Math.PI * 2)
    ctx.strokeStyle = '#111111'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.25
    ctx.stroke()
  }
  traceShape(ctx, marker.shape, marker.x, marker.y)
  if (marker.hollow) {
    ctx.strokeStyle = marker.color
    ctx.lineWidth = 1.75
    ctx.stroke()
    return
  }
  ctx.fillStyle = marker.color
  ctx.fill()
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)'
  ctx.lineWidth = 1
  ctx.stroke()
}

/** Nearest marker centre within `HIT_PX`, or null. */
export function hitTestMarkers(markers: readonly MarkerGeom[], x: number, y: number): number | null {
  let best = -1
  let bestDist = HIT_PX
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]
    if (!marker) continue
    const dist = Math.hypot(marker.x - x, marker.y - y)
    if (dist <= bestDist) {
      best = index
      bestDist = dist
    }
  }
  return best < 0 ? null : best
}

/**
 * Paint markers in CSS pixels. The backing store follows `devicePixelRatio`.
 * Highlighted marker is drawn last.
 */
export function drawMarkers(
  canvas: HTMLCanvasElement,
  markers: readonly MarkerGeom[],
  highlight: number | null,
  cssWidth: number,
  cssHeight: number,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
  const width = Math.max(1, Math.round(cssWidth * dpr))
  const height = Math.max(1, Math.round(cssHeight * dpr))
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssWidth, cssHeight)
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]
    if (!marker || index === highlight) continue
    drawErrorBars(ctx, marker)
  }
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]
    if (!marker || index === highlight) continue
    drawMarker(ctx, marker, false)
  }
  if (highlight === null) return
  const active = markers[highlight]
  if (!active) return
  drawErrorBars(ctx, active)
  drawMarker(ctx, active, true)
}
