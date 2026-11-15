/**
 * Difference overlays in overlay-pixel space. FRONTEND_SPEC §11.3.
 * Contour vertices arrive in binary pixel coordinates and go through `gridToOverlay`,
 * which is the overlay convention of §9.2 and not a data flip.
 * Stroke widths are multiplied by `cssPixel` so they stay constant on screen.
 */
import { diffCopy } from '../config/copy'
import type { ContourLine } from '../core/contours'
import type { FrameOverlayHelpers } from './FrameCanvas'

export interface DiffMark {
  x: number
  y: number
}

export interface DiffDraw {
  positive: readonly ContourLine[]
  negative: readonly ContourLine[]
  showContours: boolean
  a: DiffMark | null
  b: DiffMark | null
}

const INK = '#0b1020'
const HALO = 'rgba(255, 255, 255, 0.92)'

function strokeTwice(ctx: CanvasRenderingContext2D, cssPixel: number, dashed: boolean): void {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash(dashed ? [3 * cssPixel, 2.2 * cssPixel] : [])
  ctx.strokeStyle = HALO
  ctx.lineWidth = 3.4 * cssPixel
  ctx.stroke()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.5 * cssPixel
  ctx.stroke()
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  helpers: FrameOverlayHelpers,
  lines: readonly ContourLine[],
  dashed: boolean,
): void {
  if (lines.length === 0) return
  ctx.save()
  ctx.beginPath()
  for (const line of lines) {
    let first = true
    for (const point of line.points) {
      const { u, v } = helpers.gridToOverlay(point.x, point.y)
      if (first) ctx.moveTo(u, v)
      else ctx.lineTo(u, v)
      first = false
    }
    if (line.closed) ctx.closePath()
  }
  strokeTwice(ctx, helpers.cssPixel, dashed)
  ctx.restore()
}

function drawMark(
  ctx: CanvasRenderingContext2D,
  helpers: FrameOverlayHelpers,
  mark: DiffMark,
  label: string,
  side: -1 | 1,
): void {
  const { u, v } = helpers.gridToOverlay(mark.x, mark.y)
  const arm = 7 * helpers.cssPixel
  const gap = 2.2 * helpers.cssPixel
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(u - arm, v)
  ctx.lineTo(u - gap, v)
  ctx.moveTo(u + gap, v)
  ctx.lineTo(u + arm, v)
  ctx.moveTo(u, v - arm)
  ctx.lineTo(u, v - gap)
  ctx.moveTo(u, v + gap)
  ctx.lineTo(u, v + arm)
  strokeTwice(ctx, helpers.cssPixel, false)
  const size = 11 * helpers.cssPixel
  ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`
  ctx.textAlign = side < 0 ? 'right' : 'left'
  ctx.textBaseline = side < 0 ? 'bottom' : 'top'
  const lx = u + side * (arm + 1 * helpers.cssPixel)
  const ly = v + side * (arm * 0.2)
  ctx.lineWidth = 3 * helpers.cssPixel
  ctx.strokeStyle = HALO
  ctx.strokeText(label, lx, ly)
  ctx.fillStyle = INK
  ctx.fillText(label, lx, ly)
  ctx.restore()
}

/** Contours (positive solid, negative dashed) and the A and B predicted-position cross-hairs. */
export function drawDiffOverlay(ctx: CanvasRenderingContext2D, helpers: FrameOverlayHelpers, draw: DiffDraw): void {
  if (draw.showContours) {
    drawLines(ctx, helpers, draw.positive, false)
    drawLines(ctx, helpers, draw.negative, true)
  }
  if (draw.a) drawMark(ctx, helpers, draw.a, diffCopy.markerA, -1)
  if (draw.b) drawMark(ctx, helpers, draw.b, diffCopy.markerB, 1)
}
