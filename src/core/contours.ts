/**
 * Marching squares on a binary-order grid. FRONTEND_SPEC §11.3.
 * Values are evaluated at pixel centres (integer coordinates). Vertices are returned in
 * binary pixel coordinates `(x, y)`; the overlay layer converts them for drawing.
 * Cells with any non-finite corner are skipped. This module does not touch React or the DOM.
 */

export interface ContourPoint {
  x: number
  y: number
}

export interface ContourLine {
  points: ContourPoint[]
  closed: boolean
}

/**
 * Edge ids: horizontal edge `(x, y)-(x+1, y)` is `y * W + x`;
 * vertical edge `(x, y)-(x, y+1)` is `H * W + y * W + x`.
 */
function edgePoint(id: number, S: Float32Array, H: number, W: number, level: number): ContourPoint {
  const vertical = id >= H * W
  const local = vertical ? id - H * W : id
  const y = Math.floor(local / W)
  const x = local - y * W
  const other = vertical ? (y + 1) * W + x : y * W + x + 1
  const v0 = S[local] ?? Number.NaN
  const v1 = S[other] ?? Number.NaN
  const t = (level - v0) / (v1 - v0)
  return vertical ? { x, y: y + t } : { x: x + t, y }
}

/** Contour polylines of `S` (binary order, `H * W`) at `level`. A pixel counts as above when `S >= level`. */
export function contourLines(S: Float32Array, H: number, W: number, level: number): ContourLine[] {
  const links = new Map<number, number[]>()
  const link = (a: number, b: number): void => {
    const la = links.get(a)
    if (la) la.push(b)
    else links.set(a, [b])
    const lb = links.get(b)
    if (lb) lb.push(a)
    else links.set(b, [a])
  }

  for (let y = 0; y < H - 1; y += 1) {
    for (let x = 0; x < W - 1; x += 1) {
      const v0 = S[y * W + x] ?? Number.NaN
      const v1 = S[y * W + x + 1] ?? Number.NaN
      const v2 = S[(y + 1) * W + x + 1] ?? Number.NaN
      const v3 = S[(y + 1) * W + x] ?? Number.NaN
      if (!Number.isFinite(v0) || !Number.isFinite(v1) || !Number.isFinite(v2) || !Number.isFinite(v3)) continue
      const b0 = v0 >= level
      const b1 = v1 >= level
      const b2 = v2 >= level
      const b3 = v3 >= level
      if (b0 === b1 && b1 === b2 && b2 === b3) continue
      const bottom = y * W + x
      const right = H * W + y * W + x + 1
      const top = (y + 1) * W + x
      const left = H * W + y * W + x
      const crossing: number[] = []
      if (b0 !== b1) crossing.push(bottom)
      if (b1 !== b2) crossing.push(right)
      if (b2 !== b3) crossing.push(top)
      if (b3 !== b0) crossing.push(left)
      if (crossing.length === 2) {
        const [a, b] = crossing
        if (a !== undefined && b !== undefined) link(a, b)
        continue
      }
      // Saddle: the centre value decides which corners are joined. Isolate corners that differ from it.
      const centreAbove = (v0 + v1 + v2 + v3) / 4 >= level
      const corners: readonly (readonly [boolean, number, number])[] = [
        [b0, left, bottom],
        [b1, bottom, right],
        [b2, right, top],
        [b3, top, left],
      ]
      for (const [above, e1, e2] of corners) {
        if (above !== centreAbove) link(e1, e2)
      }
    }
  }

  const visited = new Set<number>()
  const lines: ContourLine[] = []
  const walk = (start: number): ContourLine => {
    const ids: number[] = [start]
    visited.add(start)
    let previous = -1
    let current = start
    let closed = false
    for (;;) {
      const next = (links.get(current) ?? []).find((id) => id !== previous && (!visited.has(id) || id === start))
      if (next === undefined) break
      if (next === start && ids.length > 2) {
        closed = true
        break
      }
      if (visited.has(next)) break
      ids.push(next)
      visited.add(next)
      previous = current
      current = next
    }
    return { points: ids.map((id) => edgePoint(id, S, H, W, level)), closed }
  }

  // Open chains first, starting at their ends, then whatever remains is a closed loop.
  for (const [id, neighbours] of links) {
    if (neighbours.length === 1 && !visited.has(id)) lines.push(walk(id))
  }
  for (const id of links.keys()) {
    if (!visited.has(id)) lines.push(walk(id))
  }
  return lines
}
