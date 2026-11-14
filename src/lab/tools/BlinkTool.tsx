/**
 * Blink tool. FRONTEND_SPEC §10.1–§10.3, §10.5, §10.6.
 * Stretch limits are computed once per set key, from plane 0 of every item.
 */
import { useCallback, useEffect, useMemo, type KeyboardEvent } from 'react'
import type { Coadd, Frame } from '../../contract/types'
import {
  blinkLimits,
  defaultDetector,
  defaultLambda0,
  enabledDetectors,
  FPS_MAX,
  FPS_MIN,
  K_MAX,
  selectEpochCoadds,
  selectFrames,
  setKey,
} from '../../core/blink'
import type { StretchLimits } from '../../core/stretch'
import { propagate, worldToPixel } from '../../core/wcs'
import type { Dataset } from '../../data/dataset'
import { useWorkspaceStore, type BlinkOverlays } from '../../state/store'
import { FrameCanvas, type FrameOverlayHelpers } from '../FrameCanvas'
import { drawBlinkOverlay, type GridMark } from '../blinkOverlay'
import { DetectorPicker } from '../widgets/DetectorPicker'
import { GaiaSummary } from '../widgets/GaiaSummary'
import { TimeSlider, type TimeTick } from '../widgets/TimeSlider'
import { WavelengthWindow } from '../widgets/WavelengthWindow'

const openedDatasets = new WeakSet<object>()
const limitCache = new WeakMap<object, Map<string, StretchLimits>>()

const OVERLAYS: readonly { key: keyof BlinkOverlays; label: string }[] = [
  { key: 'predicted', label: 'Predicted' },
  { key: 'apertures', label: 'Apertures' },
  { key: 'annulus', label: 'Annulus' },
  { key: 'centroid', label: 'Centroid' },
  { key: 'trail', label: 'Trail' },
]

function cachedLimits(dataset: object, key: string, build: () => StretchLimits): StretchLimits {
  let bucket = limitCache.get(dataset)
  if (!bucket) {
    bucket = new Map()
    limitCache.set(dataset, bucket)
  }
  const found = bucket.get(key)
  if (found) return found
  const limits = build()
  bucket.set(key, limits)
  return limits
}

function frameCaption(frame: Frame): string {
  const parts = [
    frame.obs_time_utc,
    `MJD ${frame.mjd.toFixed(3)}`,
    `D${frame.detector}`,
    `${frame.lambda_um.toFixed(3)} µm (bandwidth ${frame.bandwidth_um.toFixed(3)} µm)`,
    frame.release,
    frame.processing_version ?? 'n/a',
    `E${frame.epoch_id}`,
    `good ${(frame.good_fraction * 100).toFixed(1)}%`,
    `contamination level ${frame.contamination_level}`,
    `alignment ${frame.alignment_residual_px === null ? 'unknown' : `${frame.alignment_residual_px.toFixed(3)} px`}`,
  ]
  if (frame.saturated_pixels > 0) parts.push(`saturated pixels ${frame.saturated_pixels}`)
  return parts.join(' · ')
}

function coaddCaption(coadd: Coadd): string {
  const epoch = coadd.epoch_id === null ? 'epoch n/a' : `E${coadd.epoch_id}`
  const detector = coadd.detector === null ? 'detector n/a' : `D${coadd.detector}`
  const range = `${coadd.lambda_min_um.toFixed(3)} to ${coadd.lambda_max_um.toFixed(3)} µm`
  return `${epoch} · ${detector} · MJD ${coadd.mjd_mean.toFixed(3)} · ${range}. Coadd of ${coadd.n_frames} frames spanning this wavelength range.`
}

/** MJD 0 is 1858-11-17. Used for coadds, which have no `obs_time_utc`. */
function mjdToUtc(mjd: number): string {
  const ms = (mjd - 40587) * 86400000
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return 'unknown date'
  return date.toISOString().replace('.000Z', 'Z')
}

function targetAt(dataset: Dataset, mjd: number): GridMark | null {
  const target = dataset.meta.target
  const world = propagate(
    {
      ra0: target.input_ra_deg,
      dec0: target.input_dec_deg,
      pmra: target.pmra_mas_yr,
      pmdec: target.pmdec_mas_yr,
      refYear: target.coord_epoch_year,
    },
    mjd,
  )
  return worldToPixel(world.ra, world.dec, dataset.meta.grid)
}

function ContaminationMark({ level }: { level: 0 | 1 | 2 }) {
  if (level === 0) {
    return (
      <svg className="ws-cont-icon" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="3.2" />
      </svg>
    )
  }
  if (level === 1) {
    return (
      <svg className="ws-cont-icon" viewBox="0 0 12 12" aria-hidden="true">
        <rect x="4" y="6" width="4" height="5" rx="0.5" />
      </svg>
    )
  }
  return (
    <svg className="ws-cont-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 2.5h7M6 2.5v8" />
    </svg>
  )
}

function FrameCaption({ frame }: { frame: Frame }) {
  const tone = frame.contamination_level === 0 ? 'neutral' : frame.contamination_level === 1 ? 'amber' : 'severe'
  return (
    <p className="ws-caption">
      <span className="ws-num">{frame.obs_time_utc}</span>
      <span className="ws-num">MJD {frame.mjd.toFixed(3)}</span>
      <span className="ws-num">D{frame.detector}</span>
      <span className="ws-num">
        {frame.lambda_um.toFixed(3)} µm (bandwidth {frame.bandwidth_um.toFixed(3)} µm)
      </span>
      <span>{frame.release}</span>
      <span className="ws-num">{frame.processing_version ?? 'n/a'}</span>
      <span className="ws-num">E{frame.epoch_id}</span>
      <span className="ws-num">good {(frame.good_fraction * 100).toFixed(1)}%</span>
      <span className={`ws-chip ws-cont ws-cont--${tone}`}>
        <ContaminationMark level={frame.contamination_level} />
        contamination level {frame.contamination_level}
      </span>
      <span className="ws-num">
        alignment {frame.alignment_residual_px === null ? 'unknown' : `${frame.alignment_residual_px.toFixed(3)} px`}
      </span>
      {frame.saturated_pixels > 0 ? <span className="ws-num">saturated pixels {frame.saturated_pixels}</span> : null}
    </p>
  )
}

export function BlinkTool() {
  const dataset = useWorkspaceStore((state) => state.dataset.dataset)
  if (!dataset) return null
  return <BlinkReady dataset={dataset} />
}

function BlinkReady({ dataset }: { dataset: Dataset }) {
  const blink = useWorkspaceStore((state) => state.tool.blink)
  const reducedMotion = useWorkspaceStore((state) => state.ui.reducedMotion)
  const setBlink = useWorkspaceStore((state) => state.setBlink)
  const stepBlink = useWorkspaceStore((state) => state.stepBlink)
  const enabled = useMemo(() => enabledDetectors(dataset.frames.epochs), [dataset])
  const framesInWindow = useMemo(
    () => selectFrames(dataset.frames.frames, blink.detector, blink.lambda0, blink.k),
    [dataset, blink.detector, blink.lambda0, blink.k],
  )
  const epochCoadds = useMemo(
    () => selectEpochCoadds(dataset.coadds.coadds, blink.detector),
    [dataset, blink.detector],
  )
  const mode = blink.mode
  const count = mode === 'epochs' ? epochCoadds.length : framesInWindow.length
  const currentFrame = mode === 'frames' ? framesInWindow[blink.itemIndex] : undefined
  const currentCoadd = mode === 'epochs' ? epochCoadds[blink.itemIndex] : undefined

  const ticks: TimeTick[] = useMemo(() => {
    if (mode === 'epochs') {
      return epochCoadds.map((coadd) => ({
        mjd: coadd.mjd_mean,
        epoch_id: coadd.epoch_id ?? 0,
        date: mjdToUtc(coadd.mjd_mean),
        lambdaText: `${coadd.lambda_min_um.toFixed(3)} to ${coadd.lambda_max_um.toFixed(3)} µm`,
      }))
    }
    return framesInWindow.map((frame) => ({
      mjd: frame.mjd,
      epoch_id: frame.epoch_id,
      date: frame.obs_time_utc,
      lambdaText: `${frame.lambda_um.toFixed(3)} µm`,
    }))
  }, [mode, epochCoadds, framesInWindow])

  const limits = useMemo(() => {
    if (count === 0) return null
    const key = setKey(mode, blink.detector, blink.lambda0, blink.k)
    const lower = dataset.meta.previews.stretch.lower_percentile
    const upper = dataset.meta.previews.stretch.upper_percentile
    return cachedLimits(dataset, key, () => {
      const planes: Float32Array[] = []
      if (mode === 'epochs') {
        for (const coadd of epochCoadds) planes.push(dataset.coaddsReader.getPlane(coadd.index, 0))
      } else {
        for (const frame of framesInWindow) planes.push(dataset.framesReader.getPlane(frame.index, 0))
      }
      return blinkLimits(planes, lower, upper)
    })
  }, [dataset, mode, blink.detector, blink.lambda0, blink.k, count, epochCoadds, framesInWindow])

  const predicted = useMemo(() => {
    if (currentFrame) return { x: currentFrame.target_x, y: currentFrame.target_y }
    if (!currentCoadd) return null
    return targetAt(dataset, currentCoadd.mjd_mean)
  }, [currentFrame, currentCoadd, dataset])

  const trail = useMemo(() => {
    if (mode === 'frames') {
      const seen = new Set<number>()
      const points: GridMark[] = []
      for (const frame of framesInWindow) {
        if (seen.has(frame.epoch_id)) continue
        seen.add(frame.epoch_id)
        points.push({ x: frame.target_x, y: frame.target_y })
      }
      return points
    }
    const points: GridMark[] = []
    for (const coadd of epochCoadds) {
      const pixel = targetAt(dataset, coadd.mjd_mean)
      if (pixel) points.push(pixel)
    }
    return points
  }, [mode, framesInWindow, epochCoadds, dataset])

  const centroid = useMemo(() => {
    if (!currentFrame) return null
    const point = dataset.sedByFrame[currentFrame.index]
    if (!point || point.centroid_x === null || point.centroid_y === null || point.centroid_err_px === null) return null
    return { x: point.centroid_x, y: point.centroid_y, err: point.centroid_err_px }
  }, [currentFrame, dataset])

  const show = blink.overlays
  const apertureRadii = dataset.sed.aperture_radii_px
  const annulus = dataset.sed.annulus_px
  const drawOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, helpers: FrameOverlayHelpers) => {
      drawBlinkOverlay(ctx, helpers, {
        show,
        predicted,
        apertureRadii,
        annulus,
        centroid,
        trail,
      })
    },
    [show, predicted, apertureRadii, annulus, centroid, trail],
  )

  useEffect(() => {
    if (openedDatasets.has(dataset)) return
    openedDatasets.add(dataset)
    if (reducedMotion) setBlink({ playing: false, fps: FPS_MIN })
    else setBlink({ playing: true, fps: 2 })
  }, [dataset, reducedMotion, setBlink])

  useEffect(() => {
    if (count === 0 && blink.playing) setBlink({ playing: false })
  }, [count, blink.playing, setBlink])

  useEffect(() => {
    if (!blink.playing) return undefined
    let raf = 0
    let last = performance.now()
    let carry = 0
    const tick = (now: number) => {
      const state = useWorkspaceStore.getState()
      const current = state.tool.blink
      if (typeof document !== 'undefined' && document.hidden) {
        last = now
        carry = 0
      } else {
        const interval = 1000 / Math.min(FPS_MAX, Math.max(FPS_MIN, current.fps))
        carry += now - last
        last = now
        if (carry >= interval) {
          carry = 0
          const before = current.itemIndex
          state.stepBlink(1)
          const after = useWorkspaceStore.getState().tool.blink
          if (!after.loop && after.itemIndex === before) {
            state.setBlink({ playing: false })
            return
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [blink.playing])

  function chooseDetector(detector: typeof blink.detector): void {
    const lambda0 = defaultLambda0(dataset.frames.frames, detector, blink.k)
    setBlink({
      detector,
      lambda0: Number.isFinite(lambda0) ? lambda0 : blink.lambda0,
      itemIndex: 0,
    })
  }

  function widen(): void {
    setBlink({ k: K_MAX })
  }

  function changeDetector(): void {
    const detector = defaultDetector(dataset.frames.frames)
    const lambda0 = defaultLambda0(dataset.frames.frames, detector, K_MAX)
    setBlink({
      mode: 'frames',
      detector,
      k: blink.k,
      lambda0: Number.isFinite(lambda0) ? lambda0 : blink.lambda0,
      itemIndex: 0,
    })
  }

  function onToolKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.defaultPrevented) return
    const target = event.target
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      return
    }
    const onCanvas = target instanceof HTMLCanvasElement
    const onButton = target instanceof HTMLButtonElement
    const state = useWorkspaceStore.getState().tool.blink
    if (!onCanvas && event.key === 'ArrowLeft') {
      event.preventDefault()
      stepBlink(-1)
    } else if (!onCanvas && event.key === 'ArrowRight') {
      event.preventDefault()
      stepBlink(1)
    } else if (!onCanvas && event.key === 'Home') {
      event.preventDefault()
      setBlink({ itemIndex: 0 })
    } else if (!onCanvas && event.key === 'End') {
      event.preventDefault()
      setBlink({ itemIndex: Math.max(0, count - 1) })
    } else if (!onButton && (event.key === ' ' || event.key === 'Spacebar')) {
      event.preventDefault()
      setBlink({ playing: !state.playing })
    } else if (event.key === '[' || event.key === ']') {
      event.preventDefault()
      setBlink({ fps: state.fps + (event.key === ']' ? 1 : -1) })
    }
  }

  const caption = currentFrame ? frameCaption(currentFrame) : currentCoadd ? coaddCaption(currentCoadd) : ''
  const plane = currentFrame
    ? dataset.framesReader.getPlane(currentFrame.index, 0)
    : currentCoadd
      ? dataset.coaddsReader.getPlane(currentCoadd.index, 0)
      : null
  const sigma = currentFrame
    ? dataset.framesReader.getPlane(currentFrame.index, 1)
    : currentCoadd
      ? dataset.coaddsReader.getPlane(currentCoadd.index, 1)
      : null
  const H = dataset.meta.grid.height
  const W = dataset.meta.grid.width

  return (
    // Shortcuts apply wherever focus sits in the tool, so this is a scope rather than a widget.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="ws-blink" onKeyDown={onToolKeyDown}>
      <div className="ws-seg" role="radiogroup" aria-label="Blink mode">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'frames'}
          onClick={() => setBlink({ mode: 'frames', itemIndex: 0 })}
        >
          Frames
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'epochs'}
          onClick={() => setBlink({ mode: 'epochs', itemIndex: 0 })}
        >
          Epochs
        </button>
      </div>
      <DetectorPicker enabled={enabled} value={blink.detector} onChange={chooseDetector} />
      {mode === 'frames' ? (
        <WavelengthWindow
          frames={dataset.frames.frames}
          detector={blink.detector}
          lambda0={blink.lambda0}
          k={blink.k}
          onLambda0={(lambda0) => setBlink({ lambda0 })}
          onK={(k) => setBlink({ k })}
        />
      ) : null}
      <div className="ws-blink-controls" role="group" aria-label="Overlays">
        {OVERLAYS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="ws-pill"
            aria-pressed={show[entry.key]}
            onClick={() => setBlink({ overlays: { [entry.key]: !show[entry.key] } })}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className="ws-blink-controls">
        <button
          type="button"
          className="ws-pill ws-pill--primary"
          aria-pressed={blink.playing}
          onClick={() => setBlink({ playing: !blink.playing })}
        >
          {blink.playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="ws-pill" aria-label="Previous item" onClick={() => stepBlink(-1)}>
          Previous
        </button>
        <button type="button" className="ws-pill" aria-label="Next item" onClick={() => stepBlink(1)}>
          Next
        </button>
        <label className="ws-range-label">
          FPS {blink.fps}
          <input
            className="ws-range"
            type="range"
            min={FPS_MIN}
            max={FPS_MAX}
            step={1}
            value={blink.fps}
            aria-label="Frames per second"
            aria-valuetext={`${blink.fps} frames per second`}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) setBlink({ fps: next })
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') event.stopPropagation()
            }}
          />
        </label>
        <button type="button" className="ws-pill" aria-pressed={blink.loop} onClick={() => setBlink({ loop: !blink.loop })}>
          Loop
        </button>
      </div>
      {count === 0 || !plane || !sigma || !limits ? (
        <div className="ws-state" role="status">
          <p>No frames in this window</p>
          <div className="ws-blink-actions">
            <button type="button" className="ws-pill ws-pill--primary" onClick={widen}>
              Widen the window
            </button>
            <button type="button" className="ws-pill" onClick={changeDetector}>
              Change detector
            </button>
          </div>
          <GaiaSummary />
        </div>
      ) : (
        <>
          {currentFrame ? <FrameCaption frame={currentFrame} /> : <p className="ws-caption">{caption}</p>}
          <GaiaSummary />
          <FrameCanvas
            plane={plane}
            sigma={sigma}
            H={H}
            W={W}
            limits={limits}
            grid={dataset.meta.grid}
            pixelScaleArcsec={dataset.meta.grid.pixel_scale_arcsec}
            ariaLabel={`${caption}. Grayscale intensity in MJy/sr, north up, east left.`}
            caption={caption}
            drawOverlay={drawOverlay}
          />
        </>
      )}
      {count > 0 ? (
        <TimeSlider
          items={ticks}
          index={blink.itemIndex}
          spacing={blink.spacing}
          epochColor={dataset.epochColor}
          onIndex={(itemIndex) => setBlink({ itemIndex })}
          onSpacing={(spacing) => setBlink({ spacing })}
          onStep={stepBlink}
          onTogglePlay={() => setBlink({ playing: !useWorkspaceStore.getState().tool.blink.playing })}
          onFps={(delta) => setBlink({ fps: useWorkspaceStore.getState().tool.blink.fps + delta })}
        />
      ) : null}
    </div>
  )
}
