/**
 * Lambda-time plane, light-curve strip, and wavelength brush.
 * FRONTEND_SPEC §13.3. Axes are SVG. Cells and strip markers are Canvas 2D.
 * Plotted values come from sed.json and meta. The time axis uses frames.epochs.
 * Hover reads the frame contamination level, which sed points do not carry.
 */
import { format } from 'd3-format'
import { scaleLinear, scaleLog } from 'd3-scale'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { ASINH_SOFTENING } from '../../config/constants'
import {
  gaiaCopy,
  lineMarkerDisplayName,
  lineMarkerHover,
  photometry,
  sedCopy,
  sedPointHover,
} from '../../config/copy'
import type { ChannelRow, Detector, Epoch, SedPoint } from '../../contract/types'
import { K_MAX, K_MIN } from '../../core/blink'
import { epochLabel, epochShape, type EpochShape } from '../../core/epochs'
import {
  asinhScale,
  bandMembers,
  buildCompressedAxis,
  buildTrueAxis,
  dichroicBand,
  fluxAt,
  fluxErrAt,
  lambdaDomain,
  lambdaTimeCellPx,
  signedAsinh,
  toCsv,
  type TimeSegment,
} from '../../core/sed'
import { asinhValue, percentile, sequentialRgb, viridisRgb } from '../../core/stretch'
import { EPOCH_PALETTE, type Dataset } from '../../data/dataset'
import { useWorkspaceStore, type SedState } from '../../state/store'
import { drawCells, hitTestCells, type FluxCell } from '../lambdaTimeDraw'
import { drawMarkers, hitTestMarkers, type MarkerGeom } from '../sedDraw'

const axisFormat = format('.4~g')
const MJD_UNIX_EPOCH = 40587

const MARGIN = { top: 58, right: 84, bottom: 52, left: 64 }
const PLOT_H = 260
const STRIP_H = 140
const STRIP_TOP = 16
const STRIP_BOTTOM = 22

interface PlacedCell {
  point: SedPoint
  cell: FluxCell
}

interface DragState {
  mode: 'move' | 'high' | 'low'
  startY: number
  originLambda0: number
  originK: number
  moved: boolean
}

function exactNumber(value: number): string {
  return String(value)
}

function mjdToUtcDate(mjd: number): string {
  const date = new Date((mjd - MJD_UNIX_EPOCH) * 86400000)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function positiveDomain(lo: number, hi: number): [number, number] {
  const floor = 1e-4
  const start = lo > 0 ? lo : floor
  const end = hi > start ? hi : start * 10
  return [start, end]
}

function paddedExtent(values: readonly number[]): [number, number] {
  let lo = values[0] ?? 0
  let hi = lo
  for (const value of values) {
    if (value < lo) lo = value
    if (value > hi) hi = value
  }
  if (!(hi > lo)) {
    lo -= 1
    hi += 1
  }
  const pad = (hi - lo) * 0.08
  return [lo - pad, hi + pad]
}

function clampK(k: number): number {
  if (!Number.isFinite(k)) return K_MIN
  return Math.min(K_MAX, Math.max(K_MIN, k))
}

function referenceBandwidth(channels: readonly ChannelRow[], lambda0: number): number {
  let best: ChannelRow | undefined
  let bestDist = Number.POSITIVE_INFINITY
  for (const channel of channels) {
    const dist = Math.abs(channel.lambda_um - lambda0)
    if (dist < bestDist) {
      best = channel
      bestDist = dist
    }
  }
  if (best && best.bandwidth_um !== null && best.bandwidth_um > 0) return best.bandwidth_um
  return 0.02
}

function detectorMark(detector: Detector): { color: string; shape: EpochShape } {
  const index = detector - 1
  const color = EPOCH_PALETTE[index] ?? '#999999'
  const shape = epochShape(index * 8)
  return { color, shape }
}

function contaminationText(dataset: Dataset, frameIndex: number): string {
  const frame = dataset.frames.frames[frameIndex]
  if (frame && frame.index === frameIndex) return String(frame.contamination_level)
  for (const candidate of dataset.frames.frames) {
    if (candidate.index === frameIndex) return String(candidate.contamination_level)
  }
  return gaiaCopy.notAvailable
}

function describePoint(dataset: Dataset, point: SedPoint, aperture: number): string {
  const flux = fluxAt(point, aperture)
  const err = fluxErrAt(point, aperture)
  return sedPointHover({
    obsTimeUtc: point.obs_time_utc,
    epochId: point.epoch_id,
    detector: point.detector,
    lambdaUm: exactNumber(point.lambda_um),
    bandwidthUm: exactNumber(point.bandwidth_um),
    fluxMjy: flux === null ? '' : exactNumber(flux),
    fluxErrMjy: err === null || !Number.isFinite(err) ? '' : exactNumber(err),
    contamination: contaminationText(dataset, point.frame_index),
    flagged: point.flagged,
  })
}

function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function BreakMark({ x, y }: { x: number; y: number }) {
  return (
    <g className="lt-break" transform={`translate(${x} ${y})`} aria-hidden="true">
      <path d="M-3 -7 L3 1 M-3 -1 L3 7" />
    </g>
  )
}

/** Lambda-time plane rendered inside the SED tool. */
export function LambdaTimeView({
  dataset,
  sed,
  points,
  epochs,
  onEpochHeader,
}: {
  dataset: Dataset
  sed: SedState
  points: readonly SedPoint[]
  epochs: readonly Epoch[]
  onEpochHeader: (epochId: number) => void
}) {
  const openFrameInBlink = useWorkspaceStore((state) => state.openFrameInBlink)
  const setSed = useWorkspaceStore((state) => state.setSed)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stripCanvasRef = useRef<HTMLCanvasElement>(null)
  const cellsRef = useRef<PlacedCell[]>([])
  const stripRef = useRef<MarkerGeom[]>([])
  const stripPointsRef = useRef<SedPoint[]>([])
  const dragRef = useRef<DragState | null>(null)
  const moveRaf = useRef(0)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const [stripHover, setStripHover] = useState<number | null>(null)
  const [lineHover, setLineHover] = useState<{ name: string; lambdaUm: number; y: number } | null>(null)
  const patternRaw = useId()
  const patternId = `lt-dichroic-${patternRaw.replace(/:/g, '')}`
  const gradientId = `lt-flux-${patternRaw.replace(/:/g, '')}`
  const tipId = useId()

  useLayoutEffect(() => {
    const node = stageRef.current
    if (!node) return
    const read = (next: number) => {
      setWidth((current) => (Math.abs(current - next) < 0.5 ? current : next))
    }
    read(node.clientWidth)
    const observer = new ResizeObserver((entries) => {
      read(entries[0]?.contentRect.width ?? 0)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setHover(null)
    setStripHover(null)
  }, [points, sed.aperture, sed.logX, sed.asinhY, sed.timeAxis, sed.band.lambda0, sed.band.k])

  const plotW = Math.max(1, width - MARGIN.left - MARGIN.right)
  const svgH = MARGIN.top + PLOT_H + MARGIN.bottom
  const stripSvgH = STRIP_TOP + STRIP_H + STRIP_BOTTOM

  const model = useMemo(() => {
    const [domainLo, domainHi] = lambdaDomain(dataset.meta.channels)
    const [yLo, yHi] = sed.logX ? positiveDomain(domainLo, domainHi) : [domainLo, domainHi]
    const yScale = (sed.logX ? scaleLog() : scaleLinear()).domain([yLo, yHi]).range([PLOT_H, 0]).clamp(true)
    const yOf = (lambdaUm: number) => {
      if (sed.logX && !(lambdaUm > 0)) return yScale(yLo)
      return yScale(lambdaUm)
    }
    const pxPerUm = PLOT_H / Math.max(domainHi - domainLo, 1e-9)
    const compressed = buildCompressedAxis(epochs, plotW)
    const truth = buildTrueAxis(epochs, plotW)
    const xOf = (point: SedPoint) =>
      sed.timeAxis === 'compressed' ? compressed.mjdToX(point.epoch_id, point.mjd) : truth.mjdToX(point.mjd)
    const fluxes: number[] = []
    for (const point of points) {
      const flux = fluxAt(point, sed.aperture)
      if (flux !== null && Number.isFinite(flux)) fluxes.push(flux)
    }
    const samples = new Float32Array(fluxes)
    const stretch = dataset.meta.previews.stretch
    const colorLo = fluxes.length === 0 ? 0 : percentile(samples, stretch.lower_percentile)
    const colorHi = fluxes.length === 0 ? 1 : percentile(samples, stretch.upper_percentile)
    const placed: PlacedCell[] = []
    for (const point of points) {
      const flux = fluxAt(point, sed.aperture)
      const xCenter = xOf(point)
      const yCenter = yOf(point.lambda_um)
      if (flux === null || !Number.isFinite(flux) || !Number.isFinite(xCenter) || !Number.isFinite(yCenter)) continue
      const lowLambda = point.lambda_um - point.bandwidth_um / 2
      const highLambda = point.lambda_um + point.bandwidth_um / 2
      const yEdgeA = yOf(lowLambda)
      const yEdgeB = yOf(highLambda)
      const span = Number.isFinite(yEdgeA) && Number.isFinite(yEdgeB) ? Math.abs(yEdgeB - yEdgeA) : 0
      const sized = lambdaTimeCellPx(point.bandwidth_um, pxPerUm)
      const height = Math.max(sized.heightPx, span)
      const widthPx = sized.widthPx
      const [red, green, blue] = sequentialRgb(flux, colorLo, colorHi)
      placed.push({
        point,
        cell: {
          x: xCenter - widthPx / 2,
          y: yCenter - height / 2,
          w: widthPx,
          h: height,
          color: `rgb(${red} ${green} ${blue})`,
          flagged: point.flagged,
        },
      })
    }
    const members = bandMembers(points, sed.band.lambda0, sed.band.k)
    const memberFlux: number[] = []
    const drawnOnly: number[] = []
    for (const point of members) {
      const flux = fluxAt(point, sed.aperture)
      const err = fluxErrAt(point, sed.aperture)
      if (flux === null || !Number.isFinite(flux)) continue
      drawnOnly.push(flux)
      memberFlux.push(flux)
      if (err !== null && Number.isFinite(err)) memberFlux.push(flux - err, flux + err)
    }
    const stripSoftening = asinhScale(drawnOnly)
    const stripSamples =
      memberFlux.length === 0
        ? [0, 1]
        : sed.asinhY
          ? memberFlux.map((value) => signedAsinh(value, stripSoftening))
          : memberFlux
    const [stripLo, stripHi] = paddedExtent(stripSamples)
    const stripScale = scaleLinear().domain([stripLo, stripHi]).range([STRIP_H, 0]).clamp(true)
    const stripY = (flux: number) => stripScale(sed.asinhY ? signedAsinh(flux, stripSoftening) : flux)
    const stripMarkers: MarkerGeom[] = []
    const stripPoints: SedPoint[] = []
    for (const point of members) {
      const flux = fluxAt(point, sed.aperture)
      const err = fluxErrAt(point, sed.aperture)
      const x = xOf(point)
      if (flux === null || !Number.isFinite(flux) || !Number.isFinite(x)) continue
      const y = stripY(flux)
      const mark = detectorMark(point.detector)
      let y0 = y
      let y1 = y
      let drawY = false
      if (err !== null && Number.isFinite(err)) {
        const low = stripY(flux - err)
        const high = stripY(flux + err)
        if (Number.isFinite(low) && Number.isFinite(high)) {
          y0 = Math.min(low, high)
          y1 = Math.max(low, high)
          drawY = true
        }
      }
      stripPoints.push(point)
      stripMarkers.push({
        x,
        y,
        x0: x,
        x1: x,
        y0,
        y1,
        color: mark.color,
        shape: mark.shape,
        hollow: point.flagged,
        drawXError: false,
        drawYError: drawY,
      })
    }
    const fluxTicks = scaleLinear()
      .domain([Number.isFinite(colorLo) ? colorLo : 0, Number.isFinite(colorHi) && colorHi > colorLo ? colorHi : 1])
      .ticks(4)
    let mjdMin = epochs[0]?.mjd_start ?? 0
    let mjdMax = epochs[0]?.mjd_end ?? mjdMin
    for (const epoch of epochs) {
      if (epoch.mjd_start < mjdMin) mjdMin = epoch.mjd_start
      if (epoch.mjd_end > mjdMax) mjdMax = epoch.mjd_end
    }
    const timeTicks = scaleLinear().domain([mjdMin, mjdMax]).ticks(5)
    const bw = referenceBandwidth(dataset.meta.channels, sed.band.lambda0)
    return {
      yOf,
      yScale,
      yLo,
      yHi,
      domainLo,
      domainHi,
      compressed,
      truth,
      placed,
      colorLo,
      colorHi,
      fluxTicks,
      timeTicks,
      mjdMin,
      mjdMax,
      band: dichroicBand(dataset.meta.channels),
      bw,
      stripScale,
      stripSoftening,
      stripMarkers,
      stripPoints,
      stripTicks: sed.asinhY
        ? scaleLinear()
            .domain(paddedExtent(drawnOnly.length === 0 ? [0, 1] : drawnOnly))
            .ticks(4)
        : stripScale.ticks(4),
    }
  }, [dataset, epochs, plotW, points, sed.aperture, sed.asinhY, sed.band.k, sed.band.lambda0, sed.logX, sed.timeAxis])

  cellsRef.current = model.placed
  stripRef.current = model.stripMarkers
  stripPointsRef.current = model.stripPoints

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width < MARGIN.left + MARGIN.right + 8) return
    const frame = requestAnimationFrame(() => {
      drawCells(
        canvas,
        model.placed.map((item) => item.cell),
        hover,
        plotW,
        PLOT_H,
      )
    })
    return () => cancelAnimationFrame(frame)
  }, [model, hover, plotW, width])

  useEffect(() => {
    const canvas = stripCanvasRef.current
    if (!canvas || width < MARGIN.left + MARGIN.right + 8) return
    const frame = requestAnimationFrame(() => {
      drawMarkers(canvas, model.stripMarkers, stripHover, plotW, STRIP_H)
    })
    return () => cancelAnimationFrame(frame)
  }, [model, stripHover, plotW, width])

  useEffect(() => {
    return () => {
      if (moveRaf.current) cancelAnimationFrame(moveRaf.current)
    }
  }, [])

  const yTicks = model.yScale.ticks(6)
  const bandTop = model.yOf(sed.band.lambda0 + sed.band.k * model.bw)
  const bandBottom = model.yOf(sed.band.lambda0 - sed.band.k * model.bw)
  const bandY = Math.min(bandTop, bandBottom)
  const bandH = Math.max(Math.abs(bandBottom - bandTop), 2)
  const segments: readonly TimeSegment[] = sed.timeAxis === 'compressed' ? model.compressed.segments : []

  function plotPoint(clientX: number, clientY: number, canvas: HTMLCanvasElement): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  function stageY(clientY: number): number {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return clientY - rect.top - MARGIN.top
  }

  function openCell(index: number | null): void {
    if (index === null) return
    const placed = cellsRef.current[index]
    if (!placed) return
    setHover(index)
    openFrameInBlink(placed.point.frame_index)
  }

  function openStrip(index: number | null): void {
    if (index === null) return
    const point = stripPointsRef.current[index]
    if (!point) return
    setStripHover(index)
    openFrameInBlink(point.frame_index)
  }

  function onCanvasMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const at = plotPoint(event.clientX, event.clientY, event.currentTarget)
    if (moveRaf.current) return
    moveRaf.current = requestAnimationFrame(() => {
      moveRaf.current = 0
      const index = hitTestCells(
        cellsRef.current.map((item) => item.cell),
        at.x,
        at.y,
      )
      setHover((current) => (current === index ? current : index))
    })
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLCanvasElement>) {
    const count = cellsRef.current.length
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      if (count === 0) return
      const dir = event.key === 'ArrowRight' ? 1 : -1
      setHover((current) => {
        if (current === null) return dir > 0 ? 0 : count - 1
        return (current + dir + count) % count
      })
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      if (count > 0) setHover(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      if (count > 0) setHover(count - 1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openCell(hover)
    }
  }

  function edgeMode(y: number): 'high' | 'low' | 'move' {
    if (Math.abs(y - bandY) <= 7) return 'high'
    if (Math.abs(y - (bandY + bandH)) <= 7) return 'low'
    return 'move'
  }

  function applyDrag(y: number): void {
    const drag = dragRef.current
    if (!drag) return
    if (Math.abs(y - drag.startY) > 3) drag.moved = true
    const lambda = model.yScale.invert(Math.min(PLOT_H, Math.max(0, y)))
    const startLambda = model.yScale.invert(Math.min(PLOT_H, Math.max(0, drag.startY)))
    if (drag.mode === 'move') {
      const next = Math.min(model.domainHi, Math.max(model.domainLo, drag.originLambda0 + (lambda - startLambda)))
      setSed({ band: { lambda0: next, k: drag.originK } })
      return
    }
    if (!(model.bw > 0)) return
    const span = drag.mode === 'high' ? lambda - drag.originLambda0 : drag.originLambda0 - lambda
    setSed({ band: { lambda0: drag.originLambda0, k: clampK(span / model.bw) } })
  }

  function onBandDown(event: ReactPointerEvent<SVGGElement>) {
    const y = stageY(event.clientY)
    dragRef.current = {
      mode: edgeMode(y),
      startY: y,
      originLambda0: sed.band.lambda0,
      originK: sed.band.k,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onBandMove(event: ReactPointerEvent<SVGGElement>) {
    if (dragRef.current) {
      applyDrag(stageY(event.clientY))
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    const at = plotPoint(event.clientX, event.clientY, canvas)
    const index = hitTestCells(
      cellsRef.current.map((item) => item.cell),
      at.x,
      at.y,
    )
    setHover((current) => (current === index ? current : index))
  }

  function onBandUp(event: ReactPointerEvent<SVGGElement>) {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.moved) return
    const canvas = canvasRef.current
    if (!canvas) return
    const at = plotPoint(event.clientX, event.clientY, canvas)
    openCell(hitTestCells(cellsRef.current.map((item) => item.cell), at.x, at.y))
  }

  function nudgeBand(event: ReactKeyboardEvent<SVGGElement>) {
    const domainSpan = Math.max(model.domainHi - model.domainLo, 0.01)
    const step = domainSpan * 0.02
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const sign = event.key === 'ArrowUp' ? 1 : -1
      if (event.shiftKey) {
        setSed({ band: { lambda0: sed.band.lambda0, k: clampK(sed.band.k + sign * 0.05) } })
        return
      }
      const next = Math.min(model.domainHi, Math.max(model.domainLo, sed.band.lambda0 + sign * step))
      setSed({ band: { lambda0: next, k: sed.band.k } })
    }
  }

  const hoverPoint = hover === null ? undefined : model.placed[hover]?.point
  const stripPoint = stripHover === null ? undefined : model.stripPoints[stripHover]
  const announcement = hoverPoint
    ? describePoint(dataset, hoverPoint, sed.aperture)
    : stripPoint
      ? describePoint(dataset, stripPoint, sed.aperture)
      : lineHover
        ? lineMarkerHover(lineHover.name, exactNumber(lineHover.lambdaUm))
        : ''
  const tipCell = hover === null ? undefined : model.placed[hover]?.cell
  const tipLeft = tipCell ? Math.max(8, Math.min(width - 220, MARGIN.left + tipCell.x + tipCell.w + 8)) : 0
  const tipTop = tipCell ? Math.min(svgH - 28, Math.max(8, MARGIN.top + tipCell.y)) : 0
  const ready = width >= MARGIN.left + MARGIN.right + 8
  const radius = dataset.sed.aperture_radii_px[sed.aperture] ?? 3

  return (
    <div className="lt-view">
      <div className="sed-row">
        <div className="ws-seg liquid-glass-bar" role="radiogroup" aria-label={sedCopy.timeAxisLabel}>
          <button
            type="button"
            role="radio"
            aria-checked={sed.timeAxis === 'compressed'}
            className={sed.timeAxis === 'compressed' ? 'liquid-glass-btn-active' : undefined}
            onClick={() => setSed({ timeAxis: 'compressed' })}
          >
            {sedCopy.timeCompressed}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={sed.timeAxis === 'true'}
            className={sed.timeAxis === 'true' ? 'liquid-glass-btn-active' : undefined}
            onClick={() => setSed({ timeAxis: 'true' })}
          >
            {sedCopy.timeTrue}
          </button>
        </div>
        <button
          type="button"
          className="liquid-glass-cta sed-irsa"
          onClick={() => downloadCsv(`${dataset.meta.slug}-sed-ap${radius}px.csv`, toCsv(points, sed.aperture))}
        >
          {sedCopy.downloadCsv}
        </button>
      </div>

      <div ref={stageRef} className="sed-stage lt-stage">
        {ready ? (
          <>
            {sed.timeAxis === 'compressed'
              ? model.compressed.segments.map((segment) => {
                  const color = dataset.epochColor[segment.epochId] ?? '#999999'
                  const hidden = sed.hiddenEpochs.includes(segment.epochId)
                  return (
                    <button
                      key={segment.epochId}
                      type="button"
                      className={`lt-epoch ${hidden ? 'lt-epoch-hidden' : ''}`}
                      style={{ left: MARGIN.left + segment.x0, width: Math.max(segment.x1 - segment.x0, 12) }}
                      aria-pressed={sed.epochSlice === segment.epochId}
                      aria-label={`${sedCopy.epochHeader} ${epochLabel(segment.epochId)}`}
                      onClick={() => onEpochHeader(segment.epochId)}
                    >
                      <span className="lt-swatch" style={{ background: color }} />
                      {epochLabel(segment.epochId)}
                    </button>
                  )
                })
              : model.truth.bands.map((band) => {
                  const color = dataset.epochColor[band.epochId] ?? '#999999'
                  return (
                    <button
                      key={band.epochId}
                      type="button"
                      className="lt-epoch"
                      style={{ left: MARGIN.left + band.x0, width: Math.max(band.x1 - band.x0, 12) }}
                      aria-pressed={sed.epochSlice === band.epochId}
                      aria-label={`${sedCopy.epochHeader} ${epochLabel(band.epochId)}`}
                      onClick={() => onEpochHeader(band.epochId)}
                    >
                      <span className="lt-swatch" style={{ background: color }} />
                      {epochLabel(band.epochId)}
                    </button>
                  )
                })}
            <canvas
              ref={canvasRef}
              className="sed-canvas"
              style={{ left: MARGIN.left, top: MARGIN.top, width: plotW, height: PLOT_H }}
              aria-label={sedCopy.planeLabel}
              aria-describedby={announcement ? tipId : undefined}
              tabIndex={0}
              onPointerMove={onCanvasMove}
              onPointerLeave={() => setHover(null)}
              onClick={(event) => {
                const at = plotPoint(event.clientX, event.clientY, event.currentTarget)
                openCell(hitTestCells(cellsRef.current.map((item) => item.cell), at.x, at.y))
              }}
              onKeyDown={onKeyDown}
            />
            <svg className="sed-svg" viewBox={`0 0 ${width} ${svgH}`} width={width} height={svgH}>
              <defs>
                <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="1" />
                </pattern>
                <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
                  {Array.from({ length: 9 }, (_, index) => {
                    const t = index / 8
                    const [red, green, blue] = viridisRgb(t * 255)
                    return <stop key={index} offset={`${t * 100}%`} stopColor={`rgb(${red} ${green} ${blue})`} />
                  })}
                </linearGradient>
              </defs>
              <g transform={`translate(${MARGIN.left} ${MARGIN.top})`}>
                {sed.timeAxis === 'true'
                  ? model.truth.bands.map((band) => (
                      <rect
                        key={band.epochId}
                        x={band.x0}
                        y={0}
                        width={Math.max(band.x1 - band.x0, 0)}
                        height={PLOT_H}
                        fill={dataset.epochColor[band.epochId] ?? '#999999'}
                        opacity={0.14}
                      />
                    ))
                  : null}
                {model.band ? (
                  <g className="sed-gap">
                    <rect
                      x={0}
                      y={Math.min(model.yOf(model.band.startUm), model.yOf(model.band.endUm))}
                      width={plotW}
                      height={Math.max(Math.abs(model.yOf(model.band.endUm) - model.yOf(model.band.startUm)), 1)}
                      fill={`url(#${patternId})`}
                    />
                    <text
                      className="sed-gap-label"
                      x={8}
                      y={Math.min(model.yOf(model.band.startUm), model.yOf(model.band.endUm)) + 12}
                    >
                      {photometry.dichroicGap}
                    </text>
                  </g>
                ) : null}
                {sed.timeAxis === 'compressed' ? (
                  segments.map((segment) => (
                    <line
                      key={`axis-${segment.epochId}`}
                      className="sed-axis-line"
                      x1={segment.x0}
                      x2={segment.x1}
                      y1={PLOT_H}
                      y2={PLOT_H}
                    />
                  ))
                ) : (
                  <line className="sed-axis-line" x1={0} y1={PLOT_H} x2={plotW} y2={PLOT_H} />
                )}
                <line className="sed-axis-line" x1={0} y1={0} x2={0} y2={PLOT_H} />
                {sed.timeAxis === 'compressed'
                  ? model.compressed.breaks.map((x) => <BreakMark key={`break-${x}`} x={x} y={PLOT_H} />)
                  : null}
                {sed.timeAxis === 'compressed'
                  ? model.compressed.segments.map((segment) => (
                      <g key={`tick-${segment.epochId}`} transform={`translate(${segment.x0} ${PLOT_H})`}>
                        <line className="sed-axis-line" y2={5} />
                        <text className="sed-axis" y={16} textAnchor="start" transform="rotate(32)">
                          {mjdToUtcDate(segment.mjdStart)}
                        </text>
                      </g>
                    ))
                  : model.timeTicks.map((tick) => (
                      <g key={`time-${tick}`} transform={`translate(${model.truth.mjdToX(tick)} ${PLOT_H})`}>
                        <line className="sed-axis-line" y2={5} />
                        <text className="sed-axis" y={16} textAnchor="middle">
                          {mjdToUtcDate(tick)}
                        </text>
                      </g>
                    ))}
                {yTicks.map((tick) => (
                  <g key={`y-${tick}`} transform={`translate(0 ${model.yOf(tick)})`}>
                    <line className="sed-axis-line" x2={-5} />
                    <text className="sed-axis" x={-8} dy="0.32em" textAnchor="end">
                      {axisFormat(tick)}
                    </text>
                  </g>
                ))}
                <text className="sed-axis" transform={`translate(-48 ${PLOT_H / 2}) rotate(-90)`} textAnchor="middle">
                  {sedCopy.wavelengthAxis}
                </text>
                {sed.showLines
                  ? dataset.meta.processing.line_markers.map((marker, index) => {
                      const y = model.yOf(marker.lambda_um)
                      if (!Number.isFinite(y)) return null
                      const label = lineMarkerHover(marker.name, exactNumber(marker.lambda_um))
                      return (
                        <g
                          key={marker.name}
                          className="sed-line-hit"
                          tabIndex={0}
                          role="button"
                          aria-label={label}
                          onMouseEnter={() => setLineHover({ name: marker.name, lambdaUm: marker.lambda_um, y })}
                          onMouseLeave={() => setLineHover(null)}
                          onFocus={() => setLineHover({ name: marker.name, lambdaUm: marker.lambda_um, y })}
                          onBlur={() => setLineHover(null)}
                          onClick={() => setLineHover({ name: marker.name, lambdaUm: marker.lambda_um, y })}
                        >
                          <title>{label}</title>
                          <line x1={0} x2={plotW} y1={y} y2={y} stroke="transparent" strokeWidth={8} />
                          <line className="sed-line" x1={0} x2={plotW} y1={y} y2={y} />
                          <text className="sed-axis" x={6 + (index % 3) * 52} y={y - 4}>
                            {lineMarkerDisplayName(marker.name)}
                          </text>
                        </g>
                      )
                    })
                  : null}
                <g
                  className="lt-brush-hit"
                  tabIndex={0}
                  role="slider"
                  aria-label={sedCopy.bandLabel}
                  aria-valuemin={model.domainLo}
                  aria-valuemax={model.domainHi}
                  aria-valuenow={sed.band.lambda0}
                  aria-orientation="vertical"
                  aria-valuetext={`${exactNumber(sed.band.lambda0)} µm, k ${exactNumber(sed.band.k)}`}
                  onPointerDown={onBandDown}
                  onPointerMove={onBandMove}
                  onPointerUp={onBandUp}
                  onPointerCancel={() => {
                    dragRef.current = null
                  }}
                  onKeyDown={nudgeBand}
                >
                  <rect className="lt-brush" x={0} y={bandY} width={plotW} height={bandH} />
                  <line className="lt-brush-edge" x1={0} x2={plotW} y1={bandY} y2={bandY} />
                  <line className="lt-brush-edge" x1={0} x2={plotW} y1={bandY + bandH} y2={bandY + bandH} />
                </g>
                <rect
                  x={plotW + 16}
                  y={0}
                  width={12}
                  height={PLOT_H}
                  fill={`url(#${gradientId})`}
                  stroke="currentColor"
                  strokeOpacity={0.4}
                  aria-label={sedCopy.colourBar}
                />
                {model.fluxTicks.map((tick) => {
                  const t = asinhValue(tick, model.colorLo, model.colorHi, ASINH_SOFTENING)
                  const y = PLOT_H - t * PLOT_H
                  if (!Number.isFinite(y)) return null
                  return (
                    <text key={`flux-${tick}`} className="sed-axis" x={plotW + 32} y={y} dy="0.32em">
                      {axisFormat(tick)}
                    </text>
                  )
                })}
              </g>
            </svg>
            {hoverPoint && tipCell ? (
              <div id={tipId} role="tooltip" className="sed-tooltip" style={{ left: tipLeft, top: tipTop }}>
                {describePoint(dataset, hoverPoint, sed.aperture)}
              </div>
            ) : null}
            {lineHover && !hoverPoint ? (
              <div id={tipId} role="tooltip" className="sed-tooltip" style={{ left: MARGIN.left + 8, top: MARGIN.top + lineHover.y + 8 }}>
                {lineMarkerHover(lineHover.name, exactNumber(lineHover.lambdaUm))}
              </div>
            ) : null}
          </>
        ) : null}
        <p className="ws-sr" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </div>

      <p className="lt-note">{sedCopy.lightCurveNote}</p>
      <div className="sed-stage" style={{ minHeight: stripSvgH }}>
        {ready ? (
          <>
            <canvas
              ref={stripCanvasRef}
              className="sed-canvas"
              style={{ left: MARGIN.left, top: STRIP_TOP, width: plotW, height: STRIP_H }}
              aria-label={sedCopy.stripLabel}
              tabIndex={0}
              onPointerMove={(event) => {
                const at = plotPoint(event.clientX, event.clientY, event.currentTarget)
                const index = hitTestMarkers(stripRef.current, at.x, at.y)
                setStripHover((current) => (current === index ? current : index))
              }}
              onPointerLeave={() => setStripHover(null)}
              onClick={(event) => {
                const at = plotPoint(event.clientX, event.clientY, event.currentTarget)
                openStrip(hitTestMarkers(stripRef.current, at.x, at.y))
              }}
              onKeyDown={(event) => {
                const count = stripPointsRef.current.length
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                  event.preventDefault()
                  if (count === 0) return
                  const dir = event.key === 'ArrowRight' ? 1 : -1
                  setStripHover((current) => {
                    if (current === null) return dir > 0 ? 0 : count - 1
                    return (current + dir + count) % count
                  })
                  return
                }
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  openStrip(stripHover)
                }
              }}
            />
            <svg className="sed-svg" viewBox={`0 0 ${width} ${stripSvgH}`} width={width} height={stripSvgH}>
              <g transform={`translate(${MARGIN.left} ${STRIP_TOP})`}>
                {sed.timeAxis === 'true'
                  ? model.truth.bands.map((band) => (
                      <rect
                        key={band.epochId}
                        x={band.x0}
                        y={0}
                        width={Math.max(band.x1 - band.x0, 0)}
                        height={STRIP_H}
                        fill={dataset.epochColor[band.epochId] ?? '#999999'}
                        opacity={0.14}
                      />
                    ))
                  : null}
                {sed.timeAxis === 'compressed' ? (
                  model.compressed.segments.map((segment) => (
                    <line
                      key={`strip-axis-${segment.epochId}`}
                      className="sed-axis-line"
                      x1={segment.x0}
                      x2={segment.x1}
                      y1={STRIP_H}
                      y2={STRIP_H}
                    />
                  ))
                ) : (
                  <line className="sed-axis-line" x1={0} y1={STRIP_H} x2={plotW} y2={STRIP_H} />
                )}
                <line className="sed-axis-line" x1={0} y1={0} x2={0} y2={STRIP_H} />
                {sed.timeAxis === 'compressed'
                  ? model.compressed.breaks.map((x) => <BreakMark key={`strip-break-${x}`} x={x} y={STRIP_H} />)
                  : null}
                {model.stripTicks.map((tick) => {
                  const y = sed.asinhY ? model.stripScale(signedAsinh(tick, model.stripSoftening)) : model.stripScale(tick)
                  return (
                    <g key={`strip-y-${tick}`} transform={`translate(0 ${y})`}>
                      <line className="sed-axis-line" x2={-5} />
                      <text className="sed-axis" x={-8} dy="0.32em" textAnchor="end">
                        {axisFormat(tick)}
                      </text>
                    </g>
                  )
                })}
                <text className="sed-axis" transform={`translate(-48 ${STRIP_H / 2}) rotate(-90)`} textAnchor="middle">
                  {sedCopy.fluxAxis}
                </text>
                {model.stripPoints.length === 0 ? (
                  <text className="sed-axis" x={plotW / 2} y={STRIP_H / 2} textAnchor="middle">
                    {sedCopy.noPoints}
                  </text>
                ) : null}
              </g>
            </svg>
            {stripPoint ? (
              <div role="tooltip" className="sed-tooltip" style={{ left: MARGIN.left + 12, top: STRIP_TOP + 8 }}>
                {describePoint(dataset, stripPoint, sed.aperture)}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
