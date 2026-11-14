/**
 * Epoch labels and runs for a sequence of items. FRONTEND_SPEC §10.6.
 * A new run starts wherever consecutive items do not share an epoch_id.
 */

export interface EpochSpan {
  epoch_id: number
  /** Index of the first item in the run. */
  start: number
  /** Exclusive end index. */
  end: number
}

/** Display label, for example "E0". */
export function epochLabel(epochId: number): string {
  return `E${epochId}`
}

/** Marker shape. Colour stays Okabe-Ito `e mod 8`; the shape steps every 8 epochs. §15.3. */
export const EPOCH_SHAPES = ['circle', 'square', 'triangle', 'diamond'] as const

export type EpochShape = (typeof EPOCH_SHAPES)[number]

/** `floor(epochId / 8) mod 4` → circle, square, triangle, diamond. */
export function epochShape(epochId: number): EpochShape {
  const index = Math.floor(epochId / 8) % EPOCH_SHAPES.length
  const wrapped = ((index % EPOCH_SHAPES.length) + EPOCH_SHAPES.length) % EPOCH_SHAPES.length
  return EPOCH_SHAPES[wrapped] ?? 'circle'
}

/**
 * Contiguous runs of the same epoch. The boundary between two items is the
 * `start` of every run after the first.
 */
export function epochSpans(epochIds: readonly number[]): EpochSpan[] {
  const spans: EpochSpan[] = []
  for (let index = 0; index < epochIds.length; index += 1) {
    const epochId = epochIds[index]
    if (epochId === undefined) continue
    const last = spans[spans.length - 1]
    if (last && last.epoch_id === epochId) {
      last.end = index + 1
    } else {
      spans.push({ epoch_id: epochId, start: index, end: index + 1 })
    }
  }
  return spans
}
