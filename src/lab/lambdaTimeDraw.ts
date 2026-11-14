/**
 * Canvas 2D cells for the lambda-time plane. Axes stay in SVG.
 * No React. Hit-testing is a linear scan.
 */

export interface FluxCell {
  x: number
  y: number
  w: number
  h: number
  /** CSS colour from the sequential LUT. */
  color: string
  flagged: boolean
}

const OUTLINE = '#111111'

export function hitTestCells(cells: readonly FluxCell[], x: number, y: number): number | null {
  let best = -1
  let bestDist = Number.POSITIVE_INFINITY
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index]
    if (!cell) continue
    if (x < cell.x || x > cell.x + cell.w || y < cell.y || y > cell.y + cell.h) continue
    const dist = Math.hypot(x - (cell.x + cell.w / 2), y - (cell.y + cell.h / 2))
    if (dist < bestDist) {
      best = index
      bestDist = dist
    }
  }
  return best < 0 ? null : best
}

function paintCell(ctx: CanvasRenderingContext2D, cell: FluxCell, highlight: boolean): void {
  ctx.fillStyle = cell.color
  ctx.fillRect(cell.x, cell.y, cell.w, cell.h)
  if (cell.flagged) {
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = 1.5
    ctx.strokeRect(cell.x + 0.75, cell.y + 0.75, Math.max(cell.w - 1.5, 0), Math.max(cell.h - 1.5, 0))
  }
  if (!highlight) return
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.25
  ctx.strokeRect(cell.x - 1.5, cell.y - 1.5, cell.w + 3, cell.h + 3)
}

/** Paint cells in CSS pixels. The backing store follows `devicePixelRatio`. */
export function drawCells(
  canvas: HTMLCanvasElement,
  cells: readonly FluxCell[],
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
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index]
    if (!cell || index === highlight) continue
    paintCell(ctx, cell, false)
  }
  if (highlight === null) return
  const active = cells[highlight]
  if (active) paintCell(ctx, active, true)
}
