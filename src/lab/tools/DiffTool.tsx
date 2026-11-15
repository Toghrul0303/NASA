/**
 * Difference imaging. FRONTEND_SPEC §11.
 * Arithmetic runs in the browser on planes already loaded; changing A, B or the mode makes no request.
 * A difference map is never described as a detection.
 */
import { useCallback, useMemo, useState } from 'react'
import { ASINH_SOFTENING, DIFF_PEAK_RADIUS_PX, S_CLIP, SIGNIFICANCE_CONTOUR } from '../../config/constants'
import { diffAlignmentBadge, diffCopy, diffIssues, diffPeakSummary } from '../../config/copy'
import { DIFF_MODE_LABELS } from '../../config/tools'
import { contourLines } from '../../core/contours'
import {
  alignmentState,
  computeDifference,
  countAtLeast,
  emptyReason,
  isStaticSkyPair,
  maxAbsWithin,
  operandResidual,
  pairingIssues,
  pairResidual,
  symmetricLimits,
  type DiffMode,
  type DiffOperand,
  type PairingContext,
} from '../../core/difference'
import { divergingRgba, normalizeLinear, normalizeSignedAsinh } from '../../core/diffColor'
import { propagate, worldToPixel } from '../../core/wcs'
import type { Dataset } from '../../data/dataset'
import { diffPairForMode, useWorkspaceStore } from '../../state/store'
import { Chip } from '../../ui/Chip'
import { FrameCanvas, type CanvasImage, type FrameOverlayHelpers, type ReadoutRow } from '../FrameCanvas'
import { drawDiffOverlay, type DiffMark } from '../diffOverlay'

type Layer = 'S' | 'D'

const MODES: readonly DiffMode[] = ['temporal', 'spectral']

function keyOf(operand: DiffOperand | null): string {
  return operand ? `${operand.kind}:${operand.index}` : ''
}

function parseKey(value: string): DiffOperand | null {
  const [kind, raw] = value.split(':')
  const index = Number(raw)
  if ((kind !== 'frame' && kind !== 'coadd') || !Number.isInteger(index) || index < 0) return null
  return { kind, index }
}

function operandLabel(ctx: PairingContext, operand: DiffOperand): string {
  if (operand.kind === 'frame') {
    const frame = ctx.frames[operand.index]
    if (!frame) return '?'
    return `E${frame.epoch_id} · D${frame.detector} · ${frame.lambda_um.toFixed(3)} µm · MJD ${frame.mjd.toFixed(3)}`
  }
  const coadd = ctx.coadds[operand.index]
  if (!coadd) return '?'
  const epoch = coadd.epoch_id === null ? diffCopy.allEpochs : `E${coadd.epoch_id}`
  const detector = coadd.detector === null ? diffCopy.allDetectors : `D${coadd.detector}`
  return `${coadd.scope} · ${epoch} · ${detector} · ${coadd.lambda_mean_um.toFixed(3)} µm`
}

function readPlanes(dataset: Dataset, operand: DiffOperand): { I: Float32Array; sigma: Float32Array } {
  const reader = operand.kind === 'frame' ? dataset.framesReader : dataset.coaddsReader
  return { I: reader.getPlane(operand.index, 0), sigma: reader.getPlane(operand.index, 1) }
}

function targetPixel(dataset: Dataset, operand: DiffOperand): DiffMark | null {
  if (operand.kind === 'frame') {
    const frame = dataset.frames.frames[operand.index]
    return frame ? { x: frame.target_x, y: frame.target_y } : null
  }
  const coadd = dataset.coadds.coadds[operand.index]
  if (!coadd) return null
  const target = dataset.meta.target
  const world = propagate(
    {
      ra0: target.input_ra_deg,
      dec0: target.input_dec_deg,
      pmra: target.pmra_mas_yr,
      pmdec: target.pmdec_mas_yr,
      refYear: target.coord_epoch_year,
    },
    coadd.mjd_mean,
  )
  return worldToPixel(world.ra, world.dec, dataset.meta.grid)
}

function formatValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return diffCopy.masked
  const abs = Math.abs(value)
  if (abs !== 0 && (abs < 0.01 || abs >= 10000)) return value.toExponential(3)
  return value.toFixed(3)
}

function OperandSelect({
  label,
  value,
  ctx,
  options,
  onChange,
}: {
  label: string
  value: DiffOperand | null
  ctx: PairingContext
  options: readonly DiffOperand[]
  onChange: (operand: DiffOperand | null) => void
}) {
  const frames = options.filter((operand) => operand.kind === 'frame')
  const coadds = options.filter((operand) => operand.kind === 'coadd')
  return (
    <label className="ws-range-label">
      {label}
      <select
        className="ws-select"
        value={keyOf(value)}
        aria-label={label}
        onChange={(event) => onChange(parseKey(event.target.value))}
      >
        <option value="">{diffCopy.noOperand}</option>
        {frames.length > 0 ? (
          <optgroup label={diffCopy.framesGroup}>
            {frames.map((operand) => (
              <option key={keyOf(operand)} value={keyOf(operand)}>
                {operandLabel(ctx, operand)}
              </option>
            ))}
          </optgroup>
        ) : null}
        {coadds.length > 0 ? (
          <optgroup label={diffCopy.coaddsGroup}>
            {coadds.map((operand) => (
              <option key={keyOf(operand)} value={keyOf(operand)}>
                {operandLabel(ctx, operand)}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </label>
  )
}

function AlignmentBadge({ rPair, arcsecPerPx }: { rPair: number | null; arcsecPerPx: number }) {
  const state = alignmentState(rPair)
  if (state === 'unknown' || rPair === null) {
    return (
      <div className="ws-blink-controls" data-alignment="unknown">
        <span className="ws-chip">{diffCopy.alignmentUnknown}</span>
        <Chip tone="partial">{diffCopy.alignmentWarning}</Chip>
        <p className="ws-caption m-0">{diffCopy.alignmentArtefact}</p>
      </div>
    )
  }
  const text = diffAlignmentBadge(state, rPair.toFixed(2), (rPair * arcsecPerPx).toFixed(2))
  return (
    <div className="ws-blink-controls" data-alignment={state}>
      <span className="ws-chip">{text}</span>
      {state === 'good' ? null : <Chip tone="partial">{diffCopy.alignmentWarning}</Chip>}
      {state === 'poor' ? <p className="ws-caption m-0">{diffCopy.alignmentArtefact}</p> : null}
    </div>
  )
}

export function DiffTool() {
  const dataset = useWorkspaceStore((state) => state.dataset.dataset)
  if (!dataset) return null
  return <DiffReady dataset={dataset} />
}

function DiffReady({ dataset }: { dataset: Dataset }) {
  const diff = useWorkspaceStore((state) => state.tool.diff)
  const blink = useWorkspaceStore((state) => state.tool.blink)
  const setDiff = useWorkspaceStore((state) => state.setDiff)
  const [layer, setLayer] = useState<Layer>('S')
  const [showContours, setShowContours] = useState(true)

  const H = dataset.meta.grid.height
  const W = dataset.meta.grid.width
  const { mode, a, b } = diff
  const ctx = useMemo<PairingContext>(
    () => ({ frames: dataset.frames.frames, coadds: dataset.coadds.coadds }),
    [dataset],
  )
  const all = useMemo<DiffOperand[]>(
    () => [
      ...ctx.frames.map((frame): DiffOperand => ({ kind: 'frame', index: frame.index })),
      ...ctx.coadds.map((coadd): DiffOperand => ({ kind: 'coadd', index: coadd.index })),
    ],
    [ctx],
  )

  const empty = all.length < 2 ? 'needs_two' : emptyReason(a, b)
  const issues = a && b && empty === null ? pairingIssues(mode, ctx, a, b) : []
  const valid = a !== null && b !== null && empty === null && issues.length === 0

  const result = useMemo(() => {
    if (!valid || !a || !b) return null
    try {
      return computeDifference(readPlanes(dataset, a), readPlanes(dataset, b))
    } catch {
      return null
    }
  }, [valid, a, b, dataset])

  const image = useMemo((): CanvasImage | null => {
    if (!result) return null
    const normalized =
      layer === 'S'
        ? normalizeLinear(result.S, S_CLIP)
        : normalizeSignedAsinh(
            result.D,
            symmetricLimits(result.D, dataset.meta.previews.stretch.upper_percentile).hi,
            ASINH_SOFTENING,
          )
    return { rgba: divergingRgba(normalized, H, W), width: W, height: H }
  }, [result, layer, dataset, H, W])

  const contours = useMemo(() => {
    if (!result) return { positive: [], negative: [] }
    return {
      positive: contourLines(result.S, H, W, SIGNIFICANCE_CONTOUR),
      negative: contourLines(result.S, H, W, -SIGNIFICANCE_CONTOUR),
    }
  }, [result, H, W])

  const markA = useMemo(() => (a ? targetPixel(dataset, a) : null), [dataset, a])
  const markB = useMemo(() => (b ? targetPixel(dataset, b) : null), [dataset, b])

  const drawOverlay = useCallback(
    (canvasCtx: CanvasRenderingContext2D, helpers: FrameOverlayHelpers) => {
      drawDiffOverlay(canvasCtx, helpers, {
        positive: contours.positive,
        negative: contours.negative,
        showContours,
        a: markA,
        b: markB,
      })
    },
    [contours, showContours, markA, markB],
  )

  const readoutRows = useCallback(
    (x: number, y: number): readonly ReadoutRow[] => {
      const index = y * W + x
      const unit = diffCopy.rowDUnit
      const d = result?.D[index]
      const s = result?.sigmaD[index]
      const sig = result?.S[index]
      const dText = formatValue(d)
      const sText = formatValue(s)
      return [
        { label: diffCopy.rowD, value: d !== undefined && Number.isFinite(d) ? `${dText} ${unit}` : dText },
        { label: diffCopy.rowSigmaD, value: s !== undefined && Number.isFinite(s) ? `${sText} ${unit}` : sText },
        { label: diffCopy.rowS, value: formatValue(sig) },
      ]
    },
    [result, W],
  )

  const rPair = useMemo(() => {
    if (!a || !b) return null
    return pairResidual(operandResidual(ctx, a), operandResidual(ctx, b))
  }, [ctx, a, b])

  const summary = useMemo(() => {
    if (!result) return null
    const count = countAtLeast(result.S, SIGNIFICANCE_CONTOUR)
    const peak = markA ? maxAbsWithin(result.S, H, W, markA.x, markA.y, DIFF_PEAK_RADIUS_PX) : Number.NaN
    return diffPeakSummary(count, Number.isFinite(peak) ? peak.toFixed(2) : 'n/a')
  }, [result, markA, H, W])

  function chooseMode(next: DiffMode): void {
    if (next === mode) return
    setDiff({ mode: next, ...diffPairForMode(dataset, next, blink) })
  }

  const caption = a && b ? `${operandLabel(ctx, a)} ${diffCopy.minus} ${operandLabel(ctx, b)}` : diffCopy.needsTwoFrames
  const arcsecPerPx = dataset.meta.grid.pixel_scale_arcsec

  return (
    <div className="ws-blink">
      <div className="ws-seg liquid-glass-bar" role="radiogroup" aria-label={diffCopy.modeLabel}>
        {MODES.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            className={mode === id ? 'liquid-glass-btn-active' : undefined}
            onClick={() => chooseMode(id)}
          >
            {DIFF_MODE_LABELS[id]}
          </button>
        ))}
      </div>
      {mode === 'spectral' ? (
        <p className="ws-caption" role="note">
          {diffCopy.spectralNote}
          {a && b && isStaticSkyPair(ctx, a, b) ? ` ${diffCopy.staticSkyNote}.` : ''}
        </p>
      ) : null}
      <div className="ws-blink-controls">
        <OperandSelect label={diffCopy.operandA} value={a} ctx={ctx} options={all} onChange={(operand) => {
            setDiff({ a: operand })
          }}
        />
        <OperandSelect
          label={diffCopy.operandB}
          value={b}
          ctx={ctx}
          options={all}
          onChange={(operand) => {
            setDiff({ b: operand })
          }}
        />
      </div>
      <div className="ws-seg liquid-glass-bar" role="radiogroup" aria-label={diffCopy.layerLabel}>
        <button
          type="button"
          role="radio"
          aria-checked={layer === 'S'}
          className={layer === 'S' ? 'liquid-glass-btn-active' : undefined}
          onClick={() => setLayer('S')}
        >
          {diffCopy.layerS}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={layer === 'D'}
          className={layer === 'D' ? 'liquid-glass-btn-active' : undefined}
          onClick={() => setLayer('D')}
        >
          {diffCopy.layerD}
        </button>
      </div>
      <div className="ws-blink-controls">
        <button
          type="button"
          className={`${showContours ? 'liquid-glass-btn-active' : 'liquid-glass-btn'} px-3 py-1 text-xs`}
          aria-pressed={showContours}
          onClick={() => setShowContours((on) => !on)}
        >
          {diffCopy.contours}
        </button>
      </div>
      <AlignmentBadge rPair={a && b ? rPair : null} arcsecPerPx={arcsecPerPx} />
      {!valid ? (
        <div
          className="ws-state rounded-2xl bg-white dark:bg-[#0A0B10]/85 backdrop-blur-md border border-black/15 dark:border-white/12 p-4"
          role="status"
        >
          {empty === 'needs_two' ? <p>{diffCopy.needsTwoFrames}</p> : null}
          {empty === 'identical' ? <p>{diffCopy.identical}</p> : null}
          {issues.map((issue) => (
            <p key={issue}>{diffIssues[issue]}</p>
          ))}
          {empty === null && issues.length === 0 ? <p>{diffCopy.noPair}</p> : null}
        </div>
      ) : image ? (
        <>
          <p className="ws-caption">{caption}</p>
          <p className="ws-caption text-zinc-600 dark:text-[#A1A1AA]">
            {mode === 'temporal' ? `${diffCopy.legendDipole}. ` : ''}
            {diffCopy.contourKey}
          </p>
          {summary ? <p className="ws-caption font-mono tabular-nums">{summary}</p> : null}
          <FrameCanvas
            image={image}
            H={H}
            W={W}
            grid={dataset.meta.grid}
            pixelScaleArcsec={arcsecPerPx}
            ariaLabel={diffCopy.ariaLabel}
            caption={caption}
            drawOverlay={drawOverlay}
            readoutRows={readoutRows}
          />
        </>
      ) : (
        <div className="ws-state rounded-2xl p-4" role="status">
          <p>{diffCopy.noPair}</p>
        </div>
      )}
      <p className="ws-caption text-zinc-600 dark:text-[#A1A1AA]">{diffCopy.caveat}</p>
    </div>
  )
}
