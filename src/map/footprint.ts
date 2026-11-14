/**
 * Grid boundary in world coordinates. FRONTEND_SPEC §8.2.
 * Corners are the outer edges of the corner pixels, converted with `pixelToWorld`.
 */
import { pixelToWorld, type Grid } from '../core/wcs'

export function footprintPolygon(grid: Grid): Array<[number, number]> {
  const width = grid.width
  const height = grid.height
  const corners: Array<readonly [number, number]> = [
    [-0.5, -0.5],
    [width - 0.5, -0.5],
    [width - 0.5, height - 0.5],
    [-0.5, height - 0.5],
  ]
  return corners.map(([x, y]) => {
    const world = pixelToWorld(x, y, grid)
    return [world.ra, world.dec]
  })
}
