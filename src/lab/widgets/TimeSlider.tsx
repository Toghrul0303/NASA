/**
 * One tick per blink item, with an epoch colour band. FRONTEND_SPEC §10.6.
 * Tick colour stays neutral until the contamination cues of F13.
 */
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { epochLabel, epochSpans } from '../../core/epochs'
import type { BlinkSpacing } from '../../state/store'

export interface TimeTick {
  mjd: number
  epoch_id: number
  date: string
  lambdaText: string
}

interface Band {
  epoch_id: number
  x0: number
  x1: number
  labelX: number
}

function layoutTicks(
  items: readonly TimeTick[],
  spacing: BlinkSpacing,
  width: number,
): { x: number[]; bands: Band[] } {
  const pad = 16
  const inner = Math.max(1, width - pad * 2)
  const n = items.length
  const x: number[] = []
  let min = items[0]?.mjd ?? 0
  let max = min
  if (spacing === 'time') {
    for (const item of items) {
      if (item.mjd < min) min = item.mjd
      if (item.mjd > max) max = item.mjd
    }
  }
  const span = max - min
  for (let index = 0; index < n; index += 1) {
    const item = items[index]
    if (!item) continue
    if (n === 1) x.push(width / 2)
    else if (spacing === 'time' && span > 0) x.push(pad + ((item.mjd - min) / span) * inner)
    else x.push(pad + (index / (n - 1)) * inner)
  }
  const bands = epochSpans(items.map((item) => item.epoch_id)).map((run) => {
    const startX = x[run.start] ?? pad
    const endX = x[run.end - 1] ?? startX
    const prev = run.start > 0 ? x[run.start - 1] : undefined
    const next = run.end < n ? x[run.end] : undefined
    const x0 = prev === undefined ? Math.max(2, startX - 10) : (prev + startX) / 2
    const x1 = next === undefined ? Math.min(width - 2, endX + 10) : (endX + next) / 2
    return { epoch_id: run.epoch_id, x0, x1, labelX: (x0 + x1) / 2 }
  })
  return { x, bands }
}

function nearestIndex(xs: readonly number[], localX: number): number {
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let index = 0; index < xs.length; index += 1) {
    const x = xs[index]
    if (x === undefined) continue
    const dist = Math.abs(x - localX)
    if (dist < bestDist) {
      best = index
      bestDist = dist
    }
  }
  return best
}

export function TimeSlider({
  items,
  index,
  spacing,
  epochColor,
  onIndex,
  onSpacing,
  onStep,
  onTogglePlay,
  onFps,
}: {
  items: readonly TimeTick[]
  index: number
  spacing: BlinkSpacing
  epochColor: readonly string[]
  onIndex: (index: number) => void
  onSpacing: (spacing: BlinkSpacing) => void
  onStep: (delta: number) => void
  onTogglePlay: () => void
  onFps: (delta: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [focused, setFocused] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const dragging = useRef(false)

  useLayoutEffect(() => {
    const node = trackRef.current
    if (!node) return undefined
    const measure = () => setWidth(node.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const layout = useMemo(() => layoutTicks(items, spacing, Math.max(width, 1)), [items, spacing, width])
  const last = Math.max(0, items.length - 1)
  const current = items.length === 0 ? 0 : Math.min(last, Math.max(0, index))
  const currentItem = items[current]
  const tipIndex = hover ?? (focused ? current : null)
  const tipItem = tipIndex === null ? undefined : items[tipIndex]
  const tipX = tipIndex === null ? 0 : (layout.x[tipIndex] ?? 0)
  const valueText = currentItem ? `${currentItem.date}, ${currentItem.lambdaText}` : 'No frames'

  function localX(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return clientX - rect.left
  }

  function selectAt(clientX: number): void {
    if (items.length === 0) return
    onIndex(nearestIndex(layout.x, localX(clientX)))
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    dragging.current = true
    event.currentTarget.focus()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Capture is unavailable when the pointer is already inactive.
    }
    const next = items.length === 0 ? null : nearestIndex(layout.x, localX(event.clientX))
    setHover(next)
    selectAt(event.clientX)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (items.length === 0) return
    const next = nearestIndex(layout.x, localX(event.clientX))
    setHover(next)
    if (dragging.current) onIndex(next)
  }

  function endPointer(): void {
    dragging.current = false
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      event.stopPropagation()
      onStep(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      event.stopPropagation()
      onStep(1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      event.stopPropagation()
      onIndex(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      event.stopPropagation()
      onIndex(last)
    } else if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      event.stopPropagation()
      onTogglePlay()
    } else if (event.key === '[' || event.key === ']') {
      event.preventDefault()
      event.stopPropagation()
      onFps(event.key === ']' ? 1 : -1)
    }
  }

  return (
    <div className="ws-time">
      <div className="ws-seg" role="radiogroup" aria-label="Tick spacing">
        <button type="button" role="radio" aria-checked={spacing === 'frame'} onClick={() => onSpacing('frame')}>
          By frame
        </button>
        <button type="button" role="radio" aria-checked={spacing === 'time'} onClick={() => onSpacing('time')}>
          By time
        </button>
      </div>
      <div
        ref={trackRef}
        className="ws-time-track"
        role="slider"
        tabIndex={0}
        aria-label="Blink time"
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={current}
        aria-valuetext={valueText}
        aria-keyshortcuts="ArrowLeft ArrowRight Home End Space [ ]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={() => {
          if (!dragging.current) setHover(null)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
      >
        {width > 0 ? (
          <svg viewBox={`0 0 ${width} 72`} width="100%" height="72" aria-hidden="true">
            {layout.bands.map((band) => (
              <g key={`${band.epoch_id}-${band.x0}`}>
                <rect
                  x={band.x0}
                  y={54}
                  width={Math.max(1, band.x1 - band.x0)}
                  height={10}
                  fill={epochColor[band.epoch_id] ?? '#999999'}
                />
                <line className="ws-epoch-sep" x1={band.x0} x2={band.x0} y1={18} y2={64} />
                <text className="ws-epoch-label" x={band.labelX} y={14} textAnchor="middle">
                  {epochLabel(band.epoch_id)}
                </text>
              </g>
            ))}
            {layout.x.map((x, tickIndex) => (
              <line
                key={`tick-${tickIndex}`}
                className="ws-time-tick"
                x1={x}
                x2={x}
                y1={26}
                y2={48}
              />
            ))}
            {layout.x[current] !== undefined ? (
              <polygon
                points={`${layout.x[current]},20 ${layout.x[current] - 5},28 ${layout.x[current] + 5},28`}
                fill="var(--ws-primary)"
              />
            ) : null}
          </svg>
        ) : null}
        {tipItem ? (
          <div className="ws-time-tip" role="tooltip" style={{ left: tipX }}>
            <span>{tipItem.date}</span>
            <span className="ws-num">{tipItem.lambdaText}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
