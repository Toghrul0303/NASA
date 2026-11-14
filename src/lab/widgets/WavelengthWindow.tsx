/**
 * Wavelength histogram and window width. FRONTEND_SPEC §10.2.
 * Drawing uses d3-scale and d3-array only.
 */
import { useMemo, type KeyboardEvent, type PointerEvent } from 'react'
import { extent, max } from 'd3-array'
import { scaleLinear } from 'd3-scale'
import type { Detector, Frame } from '../../contract/types'
import { K_MAX, K_MIN, lambdaHistogram, selectFrames } from '../../core/blink'

const BINS = 32
const VIEW_W = 320
const VIEW_H = 96
const PAD = { left: 8, right: 8, top: 8, bottom: 18 }

function nearestBandwidth(frames: readonly Frame[], detector: Detector, lambda0: number): number | null {
  let best: number | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const frame of frames) {
    if (frame.detector !== detector) continue
    const dist = Math.abs(frame.lambda_um - lambda0)
    if (dist < bestDist) {
      best = frame.bandwidth_um
      bestDist = dist
    }
  }
  return best
}

export function WavelengthWindow({
  frames,
  detector,
  lambda0,
  k,
  onLambda0,
  onK,
}: {
  frames: readonly Frame[]
  detector: Detector
  lambda0: number
  k: number
  onLambda0: (lambda0: number) => void
  onK: (k: number) => void
}) {
  const samples = useMemo(() => {
    const values: number[] = []
    for (const frame of frames) {
      if (frame.detector === detector) values.push(frame.lambda_um)
    }
    return values
  }, [frames, detector])
  const bins = useMemo(() => lambdaHistogram(frames, detector, BINS), [frames, detector])
  const count = useMemo(() => selectFrames(frames, detector, lambda0, k).length, [frames, detector, lambda0, k])
  const bandwidth = useMemo(() => nearestBandwidth(frames, detector, lambda0), [frames, detector, lambda0])
  const [rawMin, rawMax] = extent(samples)

  if (rawMin === undefined || rawMax === undefined) {
    return <p className="ws-caption">No wavelengths for this detector.</p>
  }

  const pad = rawMax > rawMin ? (rawMax - rawMin) * 0.06 : Math.max(bandwidth ?? 0.05, 0.05)
  const domainMin = rawMin - pad
  const domainMax = rawMax + pad
  const yMax = Math.max(1, max(bins, (bin) => bin.count) ?? 1)
  const x = scaleLinear().domain([domainMin, domainMax]).range([PAD.left, VIEW_W - PAD.right])
  const y = scaleLinear().domain([0, yMax]).range([VIEW_H - PAD.bottom, PAD.top])
  const half = bandwidth === null ? 0 : k * bandwidth
  const winX = x(lambda0 - half)
  const winW = Math.max(0, x(lambda0 + half) - winX)
  const centre = x(lambda0)

  function setFromClient(svg: SVGSVGElement, clientX: number): void {
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0) return
    const vx = ((clientX - rect.left) / rect.width) * VIEW_W
    const next = Math.min(domainMax, Math.max(domainMin, x.invert(vx)))
    onLambda0(Math.round(next * 1e6) / 1e6)
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId)
    setFromClient(event.currentTarget, event.clientX)
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>): void {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    setFromClient(event.currentTarget, event.clientX)
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>): void {
    const step = (domainMax - domainMin) / 40
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      event.stopPropagation()
      const delta = event.key === 'ArrowLeft' ? -step : step
      onLambda0(Math.min(domainMax, Math.max(domainMin, lambda0 + delta)))
    }
  }

  return (
    <div className="ws-wave">
      <div className="ws-wave-plot">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="slider"
          aria-label="Wavelength centre"
          aria-orientation="horizontal"
          aria-valuemin={domainMin}
          aria-valuemax={domainMax}
          aria-valuenow={lambda0}
          aria-valuetext={`${lambda0.toFixed(3)} µm`}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onKeyDown={onKeyDown}
        >
          <rect className="ws-wave-window" x={winX} y={PAD.top} width={winW} height={VIEW_H - PAD.top - PAD.bottom} />
          {bins.map((bin, index) => {
            const x0 = x(bin.x0)
            const x1 = x(bin.x1 === bin.x0 ? bin.x0 + (domainMax - domainMin) / BINS : bin.x1)
            const barW = Math.max(1.5, x1 - x0 - 1)
            const top = y(bin.count)
            const base = y(0)
            return (
              <rect
                key={`${bin.x0}-${index}`}
                className="ws-wave-bar"
                x={x0}
                y={top}
                width={barW}
                height={Math.max(0, base - top)}
              />
            )
          })}
          <line className="ws-wave-centre" x1={centre} x2={centre} y1={PAD.top} y2={VIEW_H - PAD.bottom} />
        </svg>
      </div>
      <div className="ws-blink-controls">
        <span className="ws-num">lambda0 {lambda0.toFixed(3)} µm</span>
        <span className="ws-num">{count} in window</span>
        <label className="ws-range-label">
          k {k.toFixed(2)}
          <input
            className="ws-range"
            type="range"
            min={K_MIN}
            max={K_MAX}
            step={0.05}
            value={k}
            aria-label="Wavelength window half-width"
            aria-valuetext={k.toFixed(2)}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) onK(next)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') event.stopPropagation()
            }}
          />
        </label>
      </div>
    </div>
  )
}
