/**
 * Blink vector overlays in overlay-pixel space. FRONTEND_SPEC §10.5.
 * Stroke widths are multiplied by `cssPixel` so they stay constant on screen.
 * The Gaia diamond is the delivered predicted-track point for this epoch.
 */
import { gaiaCopy } from '../config/copy'
import type { BlinkOverlays } from '../state/store'
import type { FrameOverlayHelpers } from './FrameCanvas'

export interface GridMark {
  x: number
  y: number
}

export interface BlinkDraw {
  show: BlinkOverlays
  predicted: GridMark | null
  apertureRadii: readonly number[]
  /** Inner and outer radius, pixels. */
  annulus: readonly [number, number] | null
  centroid: { x: number; y: number; err: number } | null
  trail: readonly GridMark[]
  /** Predicted-track point for the current epoch. Null skips the diamond. */
  gaia: GridMark | null
  gaiaColor: string
}

const PREDICTED = '#e4f222'
const APERTURE = '#f4f7fb'
const ANNULUS = '#d7dee8'
const CENTROID = '#56b4e9'
const HALO = 'rgba(4, 16, 24, 0.9)'

function trace(
  ctx: CanvasRenderingContext2D,
  cssPixel: number,
  color: string,
  dashed: boolean,
  path: () => void,
): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (dashed) ctx.setLineDash([3 * cssPixel, 2.2 * cssPixel])
  path()
  ctx.strokeStyle = HALO
  ctx.lineWidth = 3.4 * cssPixel
  ctx.stroke()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5 * cssPixel
  ctx.stroke()
  ctx.restore()
}

function circle(ctx: CanvasRenderingContext2D, u: number, v: number, radius: number): void {
  ctx.beginPath()
  ctx.arc(u, v, radius, 0, Math.PI * 2)
}

function diamond(ctx: CanvasRenderingContext2D, u: number, v: number, radius: number): void {
  ctx.beginPath()
  ctx.moveTo(u, v - radius)
  ctx.lineTo(u + radius, v)
  ctx.lineTo(u, v + radius)
  ctx.lineTo(u - radius, v)
  ctx.closePath()
}

function crosshair(ctx: CanvasRenderingContext2D, u: number, v: number, arm: number, gap: number): void {
  ctx.beginPath()
  ctx.moveTo(u - arm, v)
  ctx.lineTo(u - gap, v)
  ctx.moveTo(u + gap, v)
  ctx.lineTo(u + arm, v)
  ctx.moveTo(u, v - arm)
  ctx.lineTo(u, v - gap)
  ctx.moveTo(u, v + gap)
  ctx.lineTo(u, v + arm)
}

export function drawBlinkOverlay(ctx: CanvasRenderingContext2D, helpers: FrameOverlayHelpers, draw: BlinkDraw): void {
  const { cssPixel, gridToOverlay } = helpers

  if (draw.show.trail) {
    ctx.save()
    for (const mark of draw.trail) {
      const { u, v } = gridToOverlay(mark.x, mark.y)
      const radius = 2.4 * cssPixel
      ctx.beginPath()
      ctx.arc(u, v, radius, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
      ctx.strokeStyle = HALO
      ctx.lineWidth = cssPixel
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
  }

  const centre = draw.predicted
  if (centre && (draw.show.predicted || draw.show.apertures || draw.show.annulus)) {
    const { u, v } = gridToOverlay(centre.x, centre.y)
    if (draw.show.annulus && draw.annulus) {
      const inner = draw.annulus[0]
      const outer = draw.annulus[1]
      if (inner > 0) trace(ctx, cssPixel, ANNULUS, true, () => circle(ctx, u, v, inner))
      if (outer > 0) trace(ctx, cssPixel, ANNULUS, true, () => circle(ctx, u, v, outer))
    }
    if (draw.show.apertures) {
      for (const radius of draw.apertureRadii) {
        if (radius > 0) trace(ctx, cssPixel, APERTURE, false, () => circle(ctx, u, v, radius))
      }
    }
    if (draw.show.predicted) {
      trace(ctx, cssPixel, PREDICTED, false, () => crosshair(ctx, u, v, 7, 1.6))
      const labelX = u + 8 * cssPixel
      const labelY = v - 8 * cssPixel
      ctx.save()
      ctx.font = `${12 * cssPixel}px ui-sans-serif, system-ui, sans-serif`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 3 * cssPixel
      ctx.strokeStyle = HALO
      ctx.strokeText('predicted', labelX, labelY)
      ctx.fillStyle = PREDICTED
      ctx.fillText('predicted', labelX, labelY)
      ctx.restore()
    }
  }

  const gaia = draw.show.gaia ? draw.gaia : null
  if (gaia) {
    const { u, v } = gridToOverlay(gaia.x, gaia.y)
    const color = draw.gaiaColor
    trace(ctx, cssPixel, color, false, () => diamond(ctx, u, v, 4))
    const labelX = u + 8 * cssPixel
    const labelY = v + 10 * cssPixel
    ctx.save()
    ctx.font = `${12 * cssPixel}px ui-sans-serif, system-ui, sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 3 * cssPixel
    ctx.strokeStyle = HALO
    ctx.strokeText(gaiaCopy.predictedMarker, labelX, labelY)
    ctx.fillStyle = color
    ctx.fillText(gaiaCopy.predictedMarker, labelX, labelY)
    ctx.restore()
  }

  const centroid = draw.show.centroid ? draw.centroid : null
  if (centroid) {
    const { u, v } = gridToOverlay(centroid.x, centroid.y)
    const err = centroid.err
    if (err > 0) trace(ctx, cssPixel, CENTROID, false, () => circle(ctx, u, v, err))
    trace(ctx, cssPixel, CENTROID, false, () => crosshair(ctx, u, v, 4, 0.8))
  }
}
