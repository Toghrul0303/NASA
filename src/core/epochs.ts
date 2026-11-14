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
