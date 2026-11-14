/**
 * SED view and the lambda-time placeholder. FRONTEND_SPEC §13.1–§13.2.
 * Axes are SVG (d3-scale, d3-array, d3-format). Markers are Canvas 2D.
 * Plotted values come from sed.json and meta. The time axis uses frames.epochs.
 * Hover reads the frame contamination level, which sed points do not carry.
 */
import { extent } from 'd3-array'
import { format } from 'd3-format'
import { scaleLinear, scaleLog } from 'd3-scale'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  annulusLabel,
  apertureRadius,
  framesWithoutPhotometry,
  gaiaCopy,
  lineMarkerDisplayName,
  lineMarkerHover,
  photometry,
  sedAtEpoch,
  sedCopy,
  sedPointHover,
  solidAngleNominal,
} from '../../config/copy'
import { env } from '../../config/env'
import type { Detector, SedPoint } from '../../contract/types'
import { DETECTORS, enabledDetectors } from '../../core/blink'
import { epochLabel, epochShape, type EpochShape } from '../../core/epochs'
import {
  asinhScale,
  countWithoutPhotometry,
  dichroicBand,
  drawablePoints,
  fluxAt,
  fluxErrAt,
  lambdaDomain,
  signedAsinh,
} from '../../core/sed'
import type { Dataset } from '../../data/dataset'
import { useWorkspaceStore, type SedState } from '../../state/store'
import { drawMarkers, hitTestMarkers, type MarkerGeom } from '../sedDraw'

const numFormat = format('.4~g')

const MARGIN = { top: 48, right: 16, bottom: 46, left: 64 }
const PLOT_H = 280

interface Projected {
  point: SedPoint
  geom: MarkerGeom
}

function EpochMark({ shape, color }: { shape: EpochShape; color: string }) {
  if (shape === 'circle') {
    return (
      <svg className="sed-mark" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="4" fill={color} />
      </svg>
    )
  }
  if (shape === 'square') {
    return (
      <svg className="sed-mark" viewBox="0 0 12 12" aria-hidden="true">
        <rect x="2" y="2" width="8" height="8" fill={color} />
      </svg>
    )
  }
  if (shape === 'triangle') {
    return (
      <svg className="sed-mark" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 1.5 11 10.5H1Z" fill={color} />
      </svg>
    )
  }
  return (
    <svg className="sed-mark" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1 11 6 6 11 1 6Z" fill={color} />
    </svg>
  )
}

function paddedExtent(values: readonly number[]): [number, number] {
  const [rawLo, rawHi] = extent(values)
  let lo = rawLo ?? 0
  let hi = rawHi ?? 1
  if (!(hi > lo)) {
    lo -= 1
    hi += 1
  }
  const pad = (hi - lo) * 0.08
  return [lo - pad, hi + pad]
}

function positiveDomain(lo: number, hi: number): [number, number] {
  const floor = 1e-4
  const start = lo > 0 ? lo : floor
  const end = hi > start ? hi : start * 10
  return [start, end]
}

function localPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  return { x: clientX - rect.left, y: clientY - rect.top }
}

function contaminationText(dataset: Dataset, frameIndex: number): string {
  const frame = dataset.frames.frames[frameIndex]
  const level = frame && frame.index === frameIndex ? frame.contamination_level : undefined
  if (level === undefined) {
    for (const candidate of dataset.frames.frames) {
      if (candidate.index === frameIndex) return String(candidate.contamination_level)
    }
    return gaiaCopy.notAvailable
  }
  return String(level)
}

function projectPoints(
  points: readonly SedPoint[],
  aperture: number,
  asinh: boolean,
  softening: number,
  xOf: (lambdaUm: number) => number,
  yScale: (value: number) => number,
  colorOf: (epochId: number) => string,
): Projected[] {
  const yOf = (flux: number) => (asinh ? signedAsinh(flux, softening) : flux)
  const projected: Projected[] = []
  for (const point of points) {
    const flux = fluxAt(point, aperture)
    if (flux === null || !Number.isFinite(flux)) continue
    const err = fluxErrAt(point, aperture)
    const x = xOf(point.lambda_um)
    const y = yScale(yOf(flux))
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const half = point.bandwidth_um / 2
    const left = xOf(point.lambda_um - half)
    const right = xOf(point.lambda_um + half)
    let y0 = y
    let y1 = y
    let drawY = false
    if (err !== null && Number.isFinite(err)) {
      const low = yScale(yOf(flux - err))
      const high = yScale(yOf(flux + err))
      if (Number.isFinite(low) && Number.isFinite(high)) {
        y0 = Math.min(low, high)
        y1 = Math.max(low, high)
        drawY = true
      }
    }
    projected.push({
      point,
      geom: {
        x,
        y,
        x0: Math.min(left, right),
        x1: Math.max(left, right),
        y0,
        y1,
        color: colorOf(point.epoch_id),
        shape: epochShape(point.epoch_id),
        hollow: point.flagged,
        drawXError: Number.isFinite(left) && Number.isFinite(right),
        drawYError: drawY,
      },
    })
  }
  return projected
}

function LambdaTimePlaceholder() {
  return (
    <div className="sed-placeholder" role="status">
      <p>{sedCopy.lambdaTimePending}</p>
    </div>
  )
}

function SedPlot({ dataset, sed, points }: { dataset: Dataset; sed: SedState; points: readonly SedPoint[] }) {
  const openFrameInBlink = useWorkspaceStore((state) => state.openFrameInBlink)
  const setSed = useWorkspaceStore((state) => state.setSed)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const projectedRef = useRef<Projected[]>([])
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const moveRaf = useRef(0)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const [lineHover, setLineHover] = useState<{ name: string; lambdaUm: number; x: number } | null>(null)
  const patternRaw = useId()
  const patternId = `dichroic-${patternRaw.replace(/:/g, '')}`
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
  }, [points, sed.aperture, sed.logX, sed.asinhY])

  const plotW = Math.max(1, width - MARGIN.left - MARGIN.right)
  const svgH = PLOT_H + MARGIN.top + MARGIN.bottom

  const model = useMemo(() => {
    const [domainLo, domainHi] = lambdaDomain(dataset.meta.channels)
    const [xLo, xHi] = sed.logX ? positiveDomain(domainLo, domainHi) : [domainLo, domainHi]
    const xScale = (sed.logX ? scaleLog() : scaleLinear()).domain([xLo, xHi]).range([0, plotW]).clamp(true)
    const xOf = (lambdaUm: number) => {
      if (sed.logX && !(lambdaUm > 0)) return xScale(xLo)
      return xScale(lambdaUm)
    }
    const fluxValues: number[] = []
    const drawnFlux: number[] = []
    for (const point of points) {
      const flux = fluxAt(point, sed.aperture)
      if (flux === null || !Number.isFinite(flux)) continue
      drawnFlux.push(flux)
      fluxValues.push(flux)
      const err = fluxErrAt(point, sed.aperture)
      if (err !== null && Number.isFinite(err)) fluxValues.push(flux - err, flux + err)
    }
    const softening = asinhScale(drawnFlux)
    const ySamples =
      fluxValues.length === 0
        ? [0, 1]
        : sed.asinhY
          ? fluxValues.map((value) => signedAsinh(value, softening))
          : fluxValues
    const [yLo, yHi] = paddedExtent(ySamples)
    const yScale = scaleLinear().domain([yLo, yHi]).range([PLOT_H, 0]).clamp(true)
    const fluxTicks = scaleLinear()
      .domain(paddedExtent(fluxValues.length === 0 ? [0, 1] : fluxValues))
      .ticks(5)
    const projected = projectPoints(points, sed.aperture, sed.asinhY, softening, xOf, (value) => yScale(value), (epochId) => {
      return dataset.epochColor[epochId] ?? '#999999'
    })
    return {
      xScale,
      xOf,
      yScale,
      softening,
      xTicks: xScale.ticks(6),
      yTicks: sed.asinhY ? fluxTicks : yScale.ticks(5),
      projected,
      band: dichroicBand(dataset.meta.channels),
    }
  }, [dataset, plotW, points, sed.aperture, sed.asinhY, sed.logX])

  projectedRef.current = model.projected

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width < MARGIN.left + MARGIN.right + 8) return
    const frame = requestAnimationFrame(() => {
      drawMarkers(
        canvas,
        model.projected.map((item) => item.geom),
        hover,
        plotW,
        PLOT_H,
      )
    })
    return () => cancelAnimationFrame(frame)
  }, [model, hover, plotW, width])

  useEffect(() => {
    return () => {
      if (moveRaf.current) cancelAnimationFrame(moveRaf.current)
    }
  }, [])

  function describe(point: SedPoint): string {
    const flux = fluxAt(point, sed.aperture)
    const err = fluxErrAt(point, sed.aperture)
    return sedPointHover({
      obsTimeUtc: point.obs_time_utc,
      epochId: point.epoch_id,
      detector: point.detector,
      lambdaUm: numFormat(point.lambda_um),
      bandwidthUm: numFormat(point.bandwidth_um),
      fluxMjy: flux === null ? '' : numFormat(flux),
      fluxErrMjy: err === null || !Number.isFinite(err) ? '' : numFormat(err),
      contamination: contaminationText(dataset, point.frame_index),
      flagged: point.flagged,
    })
  }

  const hoverPoint = hover === null ? undefined : model.projected[hover]?.point
  const announcement = hoverPoint
    ? describe(hoverPoint)
    : lineHover
      ? lineMarkerHover(lineHover.name, numFormat(lineHover.lambdaUm))
      : ''

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    pointerRef.current = localPoint(event.currentTarget, event.clientX, event.clientY)
    if (moveRaf.current) return
    moveRaf.current = requestAnimationFrame(() => {
      moveRaf.current = 0
      const at = pointerRef.current
      if (!at) return
      const index = hitTestMarkers(
        projectedRef.current.map((item) => item.geom),
        at.x,
        at.y,
      )
      setHover((current) => (current === index ? current : index))
    })
  }

  function openHover(index: number | null): void {
    if (index === null) return
    const point = projectedRef.current[index]?.point
    if (!point) return
    setHover(index)
    openFrameInBlink(point.frame_index)
  }

  function onKeyDown(event: KeyboardEvent<HTMLCanvasElement>) {
    const count = projectedRef.current.length
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
      openHover(hover)
    }
  }

  const tipGeom = hover === null ? undefined : model.projected[hover]?.geom
  const tipLeft = tipGeom ? Math.max(8, Math.min(width - 200, MARGIN.left + tipGeom.x + 12)) : 0
  const tipTop = tipGeom ? Math.min(svgH - 36, Math.max(8, MARGIN.top + tipGeom.y + 12)) : 0
  const lineLeft = lineHover ? Math.max(8, Math.min(width - 200, MARGIN.left + lineHover.x + 12)) : 0

  return (
    <div className="sed-view">
      <div className="sed-row" role="group" aria-label={sedCopy.plotLabel}>
        <button
          type="button"
          className={`sed-toggle ${sed.logX ? 'liquid-glass-btn-active' : 'liquid-glass-btn'}`}
          aria-pressed={sed.logX}
          onClick={() => setSed({ logX: !sed.logX })}
        >
          {sedCopy.logWavelength}
        </button>
        <button
          type="button"
          className={`sed-toggle ${sed.asinhY ? 'liquid-glass-btn-active' : 'liquid-glass-btn'}`}
          aria-pressed={sed.asinhY}
          onClick={() => setSed({ asinhY: !sed.asinhY })}
        >
          {sedCopy.asinhFlux}
        </button>
        <button
          type="button"
          className={`sed-toggle ${sed.showLines ? 'liquid-glass-btn-active' : 'liquid-glass-btn'}`}
          aria-pressed={sed.showLines}
          onClick={() => setSed({ showLines: !sed.showLines })}
        >
          {sedCopy.lineMarkers}
        </button>
      </div>
      <div ref={stageRef} className="sed-stage">
        {width >= MARGIN.left + MARGIN.right + 8 ? (
          <>
            <canvas
              ref={canvasRef}
              className="sed-canvas"
              style={{ left: MARGIN.left, top: MARGIN.top, width: plotW, height: PLOT_H }}
              aria-label={sedCopy.plotLabel}
              aria-describedby={announcement ? tipId : undefined}
              tabIndex={0}
              onPointerMove={onPointerMove}
              onPointerLeave={() => setHover(null)}
              onClick={(event) => {
                const at = localPoint(event.currentTarget, event.clientX, event.clientY)
                openHover(hitTestMarkers(projectedRef.current.map((item) => item.geom), at.x, at.y))
              }}
              onKeyDown={onKeyDown}
            />
            <svg className="sed-svg" viewBox={`0 0 ${width} ${svgH}`} width={width} height={svgH}>
              <defs>
                <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="1" />
                </pattern>
              </defs>
              <g transform={`translate(${MARGIN.left} ${MARGIN.top})`}>
                {model.band ? (
                  <g className="sed-gap">
                    <rect
                      x={Math.min(model.xOf(model.band.startUm), model.xOf(model.band.endUm))}
                      y={0}
                      width={Math.max(Math.abs(model.xOf(model.band.endUm) - model.xOf(model.band.startUm)), 1)}
                      height={PLOT_H}
                      fill={`url(#${patternId})`}
                    />
                    <text
                      className="sed-gap-label"
                      x={
                        (model.xOf(model.band.startUm) + model.xOf(model.band.endUm)) / 2
                      }
                      y={14}
                      textAnchor="middle"
                    >
                      {photometry.dichroicGap}
                    </text>
                  </g>
                ) : null}
                <line className="sed-axis-line" x1={0} y1={PLOT_H} x2={plotW} y2={PLOT_H} />
                <line className="sed-axis-line" x1={0} y1={0} x2={0} y2={PLOT_H} />
                {model.xTicks.map((tick) => (
                  <g key={`x-${tick}`} transform={`translate(${model.xScale(tick)} ${PLOT_H})`}>
                    <line className="sed-axis-line" y2={5} />
                    <text className="sed-axis" y={16} textAnchor="middle">
                      {numFormat(tick)}
                    </text>
                  </g>
                ))}
                {model.yTicks.map((tick) => {
                  const y = sed.asinhY ? model.yScale(signedAsinh(tick, model.softening)) : model.yScale(tick)
                  return (
                    <g key={`y-${tick}`} transform={`translate(0 ${y})`}>
                      <line className="sed-axis-line" x2={-5} />
                      <text className="sed-axis" x={-8} dy="0.32em" textAnchor="end">
                        {numFormat(tick)}
                      </text>
                    </g>
                  )
                })}
                <text className="sed-axis" x={plotW / 2} y={PLOT_H + 32} textAnchor="middle">
                  {sedCopy.wavelengthAxis}
                </text>
                <text className="sed-axis" transform={`translate(-48 ${PLOT_H / 2}) rotate(-90)`} textAnchor="middle">
                  {sedCopy.fluxAxis}
                </text>
                {sed.showLines
                  ? dataset.meta.processing.line_markers.map((marker, index) => {
                      const x = model.xOf(marker.lambda_um)
                      if (!Number.isFinite(x)) return null
                      const label = lineMarkerHover(marker.name, numFormat(marker.lambda_um))
                      return (
                        <g
                          key={marker.name}
                          className="sed-line-hit"
                          tabIndex={0}
                          role="button"
                          aria-label={label}
                          onMouseEnter={() => setLineHover({ name: marker.name, lambdaUm: marker.lambda_um, x })}
                          onMouseLeave={() => setLineHover(null)}
                          onFocus={() => setLineHover({ name: marker.name, lambdaUm: marker.lambda_um, x })}
                          onBlur={() => setLineHover(null)}
                          onClick={() => setLineHover({ name: marker.name, lambdaUm: marker.lambda_um, x })}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              setLineHover(null)
                              event.currentTarget.blur()
                            }
                          }}
                        >
                          <title>{label}</title>
                          <line x1={x} x2={x} y1={0} y2={PLOT_H} stroke="transparent" strokeWidth={12} />
                          <line className="sed-line" x1={x} x2={x} y1={0} y2={PLOT_H} />
                          <text className="sed-axis" x={x} y={-34 + (index % 3) * 12} textAnchor="middle">
                            {lineMarkerDisplayName(marker.name)}
                          </text>
                        </g>
                      )
                    })
                  : null}
                {points.length === 0 ? (
                  <text className="sed-axis" x={plotW / 2} y={PLOT_H / 2} textAnchor="middle">
                    {sedCopy.noPoints}
                  </text>
                ) : null}
              </g>
            </svg>
            {hoverPoint && tipGeom ? (
              <div id={tipId} role="tooltip" className="sed-tooltip" style={{ left: tipLeft, top: tipTop }}>
                {describe(hoverPoint)}
              </div>
            ) : null}
            {lineHover && !hoverPoint ? (
              <div id={tipId} role="tooltip" className="sed-tooltip" style={{ left: lineLeft, top: MARGIN.top }}>
                {lineMarkerHover(lineHover.name, numFormat(lineHover.lambdaUm))}
              </div>
            ) : null}
          </>
        ) : null}
        <p className="ws-sr" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </div>
    </div>
  )
}

/** SED tab. Both views share the photometry controls. Lambda-time is a placeholder until the next step. */
export function SedTool() {
  const dataset = useWorkspaceStore((state) => state.dataset.dataset)
  const sed = useWorkspaceStore((state) => state.tool.sed)
  const setSed = useWorkspaceStore((state) => state.setSed)
  const present = useMemo(() => {
    if (!dataset) return new Set<number>()
    return new Set<number>(enabledDetectors(dataset.frames.epochs))
  }, [dataset])

  const points = useMemo(() => {
    if (!dataset) return []
    return drawablePoints(dataset.sed, sed.aperture, {
      hideFlagged: sed.hideFlagged,
      detectors: new Set(sed.detectors),
      hiddenEpochs: new Set(sed.hiddenEpochs),
      epochSlice: sed.epochSlice,
    })
  }, [dataset, sed.aperture, sed.hideFlagged, sed.detectors, sed.hiddenEpochs, sed.epochSlice])

  if (!dataset) return null
  const missing = countWithoutPhotometry(dataset.sed, sed.aperture)
  const irsa = env.irsaSpectrophotometryUrl
  const epochs = [...dataset.frames.epochs].sort((a, b) => a.epoch_id - b.epoch_id)

  function toggleDetector(detector: Detector): void {
    if (!present.has(detector)) return
    const next = new Set(sed.detectors)
    if (next.has(detector)) next.delete(detector)
    else next.add(detector)
    setSed({ detectors: DETECTORS.filter((item) => next.has(item)) })
  }

  function toggleEpoch(epochId: number): void {
    const next = new Set(sed.hiddenEpochs)
    if (next.has(epochId)) next.delete(epochId)
    else next.add(epochId)
    setSed({ hiddenEpochs: [...next].sort((a, b) => a - b) })
  }

  return (
    <section className="sed-tool" aria-label={sedCopy.toolLabel}>
      <header className="sed-head">
        <p className="sed-banner">{photometry.quickLook}</p>
        <p className="sed-disclaimer">{photometry.notScienceGrade}</p>
        {irsa ? (
          <a className="liquid-glass-cta sed-irsa" href={irsa} target="_blank" rel="noopener">
            {sedCopy.openIrsa}
          </a>
        ) : null}
      </header>

      <div className="sed-controls">
        <fieldset className="sed-field">
          <legend>{sedCopy.aperture}</legend>
          <div className="sed-row" role="radiogroup" aria-label={sedCopy.aperture}>
            {dataset.sed.aperture_radii_px.map((radius, index) => (
              <button
                key={radius}
                type="button"
                role="radio"
                className={`sed-toggle ${sed.aperture === index ? 'liquid-glass-btn-active' : 'liquid-glass-btn'}`}
                aria-checked={sed.aperture === index}
                onClick={() => setSed({ aperture: index })}
              >
                {apertureRadius(radius)}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="sed-row">
          <button
            type="button"
            className={`sed-toggle ${sed.hideFlagged ? 'liquid-glass-btn-active' : 'liquid-glass-btn'}`}
            aria-pressed={sed.hideFlagged}
            onClick={() => setSed({ hideFlagged: !sed.hideFlagged })}
          >
            {sedCopy.hideFlagged}
          </button>
          <p className="sed-count">{framesWithoutPhotometry(missing)}</p>
        </div>

        <fieldset className="sed-field">
          <legend>{sedCopy.detectors}</legend>
          <div className="sed-row" role="group" aria-label={sedCopy.detectors}>
            {DETECTORS.map((detector) => {
              const enabled = present.has(detector)
              const on = sed.detectors.includes(detector)
              return (
                <button
                  key={detector}
                  type="button"
                  className={`sed-toggle sed-tip-host ${on && enabled ? 'liquid-glass-btn-active' : 'liquid-glass-btn'}`}
                  aria-pressed={enabled ? on : false}
                  aria-disabled={!enabled}
                  onClick={() => toggleDetector(detector)}
                >
                  D{detector}
                  {enabled ? null : (
                    <span role="tooltip" className="ws-tip">
                      {sedCopy.noFrames}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </fieldset>

        <fieldset className="sed-field">
          <legend>{sedCopy.epochs}</legend>
          {sed.epochSlice !== null ? <p className="sed-slice">{sedAtEpoch(sed.epochSlice)}</p> : null}
          <ul className="sed-epochs">
            {epochs.map((epoch) => {
              const hidden = sed.hiddenEpochs.includes(epoch.epoch_id)
              const sliced = sed.epochSlice === epoch.epoch_id
              const color = dataset.epochColor[epoch.epoch_id] ?? '#999999'
              return (
                <li key={epoch.epoch_id} className="sed-epoch">
                  <button
                    type="button"
                    className={`sed-toggle ${!hidden ? 'liquid-glass-btn-active' : 'liquid-glass-btn'}`}
                    aria-pressed={!hidden}
                    onClick={() => toggleEpoch(epoch.epoch_id)}
                  >
                    <EpochMark shape={epochShape(epoch.epoch_id)} color={color} />
                    {epochLabel(epoch.epoch_id)}
                  </button>
                  <button
                    type="button"
                    className={`sed-toggle ${sliced ? 'liquid-glass-btn-active' : 'liquid-glass-btn'}`}
                    aria-pressed={sliced}
                    onClick={() => {
                      if (sliced) {
                        setSed({ epochSlice: null })
                        return
                      }
                      setSed({
                        epochSlice: epoch.epoch_id,
                        hiddenEpochs: sed.hiddenEpochs.filter((id) => id !== epoch.epoch_id),
                      })
                    }}
                  >
                    {sliced ? sedCopy.showAllEpochs : sedCopy.showOnlyEpoch}
                  </button>
                </li>
              )
            })}
          </ul>
        </fieldset>
      </div>

      <div className="ws-seg liquid-glass-bar" role="radiogroup" aria-label={sedCopy.viewLabel}>
        <button
          type="button"
          role="radio"
          aria-checked={sed.view === 'sed'}
          className={sed.view === 'sed' ? 'liquid-glass-btn-active' : undefined}
          onClick={() => setSed({ view: 'sed' })}
        >
          {sedCopy.viewSed}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={sed.view === 'lambdaTime'}
          className={sed.view === 'lambdaTime' ? 'liquid-glass-btn-active' : undefined}
          onClick={() => setSed({ view: 'lambdaTime' })}
        >
          {sedCopy.viewLambdaTime}
        </button>
      </div>

      {sed.view === 'lambdaTime' ? <LambdaTimePlaceholder /> : <SedPlot dataset={dataset} sed={sed} points={points} />}

      <footer className="sed-provenance">
        <p>
          {dataset.sed.solid_angle_source === 'sapm'
            ? sedCopy.solidAngleSapm
            : solidAngleNominal(dataset.sed.nominal_pixel_sr)}
        </p>
        <p>{annulusLabel(dataset.sed.annulus_px[0], dataset.sed.annulus_px[1])}</p>
      </footer>
    </section>
  )
}
