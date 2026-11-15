/**
 * False-colour RGB. FRONTEND_SPEC §12.1, §12.2, §12.4, §12.6.
 * Feature RGB and the custom editor stay disabled until F14.
 * The server PNG is drawn with north up. `composeRgb` is the only flip.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { rgbCopy, rgbGroupLine, rgbGroupSnr } from '../../config/copy'
import { ASINH_SOFTENING } from '../../config/constants'
import type { BinaryReader } from '../../core/binary'
import {
  RGB_GAIN_MAX,
  RGB_GAIN_MIN,
  combineInverseVariance,
  composeRgb,
  selectMembers,
  slotLimits,
  type RgbGains,
  type RgbMemberPreset,
} from '../../core/rgb'
import { MASK_RGB, type StretchLimits } from '../../core/stretch'
import { worldToPixel } from '../../core/wcs'
import type { Dataset } from '../../data/dataset'
import { useWorkspaceStore, type RgbState } from '../../state/store'
import { Chip } from '../../ui/Chip'
import { FrameCanvas, type CanvasImage, type FrameOverlayHelpers, type ReadoutRow } from '../FrameCanvas'

const CROSSFADE_MS = 150

type PresetChoice = RgbMemberPreset | 'feature' | 'custom'

interface SlotPlanes {
  red: Float32Array | null
  green: Float32Array | null
  blue: Float32Array | null
}

interface RgbDisplay {
  rgba: Uint8ClampedArray
  width: number
  height: number
  phase: 'preview' | 'client'
  fade: boolean
  preset: RgbMemberPreset
}

type CompositeResult = { ok: true; rgba: Uint8ClampedArray } | { ok: false }

const previewBitmaps = new Map<string, Promise<ImageBitmap>>()

function loadPreviewBitmap(url: string): Promise<ImageBitmap> {
  const cached = previewBitmaps.get(url)
  if (cached) return cached
  const pending = (async () => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`preview ${response.status}`)
    return createImageBitmap(await response.blob())
  })()
  previewBitmaps.set(url, pending)
  pending.catch(() => {
    if (previewBitmaps.get(url) === pending) previewBitmaps.delete(url)
  })
  return pending
}

/** PNG row 0 is north, so this copy is not flipped. A size mismatch scales with smoothing off. */
function rasterizePreview(bitmap: ImageBitmap, width: number, height: number): Uint8ClampedArray {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('preview canvas unavailable')
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(bitmap, 0, 0, width, height)
  return new Uint8ClampedArray(ctx.getImageData(0, 0, width, height).data)
}

function combineSlot(reader: BinaryReader, indexes: readonly number[]): Float32Array | null {
  if (indexes.length === 0) return null
  const members = indexes.map((index) => ({
    I: reader.getPlane(index, 0),
    sigma: reader.getPlane(index, 1),
  }))
  return combineInverseVariance(members).I
}

function finiteLimits(plane: Float32Array | null, lowerPct: number, upperPct: number): StretchLimits {
  if (!plane) return { lo: Number.NaN, hi: Number.NaN }
  return slotLimits(plane, lowerPct, upperPct)
}

function formatSample(value: number): string {
  const abs = Math.abs(value)
  if (abs !== 0 && (abs < 0.01 || abs >= 10000)) return value.toExponential(3)
  return value.toFixed(3)
}

function formatSlot(plane: Float32Array | null, index: number): string {
  if (!plane) return `0.000 ${rgbCopy.intensityUnit}`
  const value = plane[index]
  if (value === undefined || !Number.isFinite(value)) return rgbCopy.masked
  return `${formatSample(value)} ${rgbCopy.intensityUnit}`
}

function formatSnr(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Math.abs(value) >= 100) return value.toFixed(0)
  return value.toFixed(2)
}

function drawCrosshair(ctx: CanvasRenderingContext2D, helpers: FrameOverlayHelpers, x: number, y: number): void {
  const { u, v } = helpers.gridToOverlay(x, y)
  const arm = 7 * helpers.cssPixel
  const gap = 2.2 * helpers.cssPixel
  ctx.save()
  ctx.strokeStyle = '#e4f222'
  ctx.lineWidth = 1.5 * helpers.cssPixel
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(u - arm, v)
  ctx.lineTo(u - gap, v)
  ctx.moveTo(u + gap, v)
  ctx.lineTo(u + arm, v)
  ctx.moveTo(u, v - arm)
  ctx.lineTo(u, v - gap)
  ctx.moveTo(u, v + gap)
  ctx.lineTo(u, v + arm)
  ctx.stroke()
  ctx.restore()
}

const PRESET_CHOICES: readonly { id: PresetChoice; label: string }[] = [
  { id: 'detector', label: rgbCopy.detector },
  { id: 'equal_channel', label: rgbCopy.equalChannel },
  { id: 'feature', label: rgbCopy.feature },
  { id: 'custom', label: rgbCopy.custom },
]

function PresetButton({
  label,
  selected,
  disabled,
  tip,
  onSelect,
}: {
  label: string
  selected: boolean
  disabled: boolean
  tip?: string
  onSelect: () => void
}) {
  const tipId = useId()
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      aria-describedby={tip ? tipId : undefined}
      className={selected ? 'liquid-glass-btn-active' : undefined}
      onClick={() => {
        if (!disabled) onSelect()
      }}
    >
      {label}
      {tip ? (
        <span role="tooltip" id={tipId} className="ws-tip">
          {tip}
        </span>
      ) : null}
    </button>
  )
}

function GainSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (gain: number) => void
}) {
  return (
    <label className="ws-range-label">
      {label} {value.toFixed(2)}
      <input
        className="ws-range"
        type="range"
        min={RGB_GAIN_MIN}
        max={RGB_GAIN_MAX}
        step={0.05}
        value={value}
        aria-label={label}
        aria-valuemin={RGB_GAIN_MIN}
        aria-valuemax={RGB_GAIN_MAX}
        aria-valuenow={value}
        aria-valuetext={value.toFixed(2)}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
      />
    </label>
  )
}

export function RgbTool() {
  const dataset = useWorkspaceStore((state) => state.dataset.dataset)
  const rgb = useWorkspaceStore((state) => state.tool.rgb)
  const setRgb = useWorkspaceStore((state) => state.setRgb)
  const reducedMotion = useWorkspaceStore((state) => state.ui.reducedMotion)
  if (!dataset) return null
  return <RgbToolReady dataset={dataset} rgb={rgb} setRgb={setRgb} reducedMotion={reducedMotion} />
}

function RgbToolReady({
  dataset,
  rgb,
  setRgb,
  reducedMotion,
}: {
  dataset: Dataset
  rgb: RgbState
  setRgb: (partial: { preset?: RgbMemberPreset; linked?: boolean; gains?: Partial<RgbGains> }) => void
  reducedMotion: boolean
}) {
  const H = dataset.meta.grid.height
  const W = dataset.meta.grid.width
  const detectorRgb = dataset.coadds.rgb_presets.detector_rgb
  const previewUrl = rgb.preset === 'detector' ? dataset.previews.rgb_detector : dataset.previews.rgb_equal_channel
  const [display, setDisplay] = useState<RgbDisplay | null>(null)
  const [shownPreviewFor, setShownPreviewFor] = useState<RgbMemberPreset | null>(null)
  const [previewLabel, setPreviewLabel] = useState(false)
  const [compositorError, setCompositorError] = useState(false)
  const displayRef = useRef(display)
  displayRef.current = display

  const members = useMemo(
    () => selectMembers(rgb.preset, dataset.coadds.coadds, dataset.coadds.rgb_presets),
    [rgb.preset, dataset],
  )

  const combined = useMemo(() => {
    try {
      const reader = dataset.coaddsReader
      return {
        ok: true as const,
        red: combineSlot(reader, members.red),
        green: combineSlot(reader, members.green),
        blue: combineSlot(reader, members.blue),
      }
    } catch {
      return { ok: false as const }
    }
  }, [dataset, members])

  const composite = useMemo((): CompositeResult => {
    if (!combined.ok || H <= 0 || W <= 0) return { ok: false }
    try {
      const stretch = dataset.meta.previews.stretch
      const slots: SlotPlanes = { red: combined.red, green: combined.green, blue: combined.blue }
      const limits = [
        finiteLimits(slots.red, stretch.lower_percentile, stretch.upper_percentile),
        finiteLimits(slots.green, stretch.lower_percentile, stretch.upper_percentile),
        finiteLimits(slots.blue, stretch.lower_percentile, stretch.upper_percentile),
      ] as const
      const rgba = composeRgb(
        {
          slots: [slots.red, slots.green, slots.blue],
          limits,
          linked: rgb.linked,
          gains: rgb.gains,
          a: ASINH_SOFTENING,
          maskRGB: MASK_RGB,
        },
        H,
        W,
      )
      return { ok: true, rgba }
    } catch {
      return { ok: false }
    }
  }, [combined, dataset, rgb.linked, rgb.gains, H, W])

  useEffect(() => {
    let cancelled = false
    setCompositorError(false)
    setPreviewLabel(false)
    if (!previewUrl || H <= 0 || W <= 0) {
      setShownPreviewFor(rgb.preset)
      return () => {
        cancelled = true
      }
    }
    loadPreviewBitmap(previewUrl)
      .then((bitmap) => rasterizePreview(bitmap, W, H))
      .then((rgba) => {
        if (cancelled) return
        setPreviewLabel(true)
        setDisplay({ rgba, width: W, height: H, phase: 'preview', fade: false, preset: rgb.preset })
        setShownPreviewFor(rgb.preset)
      })
      .catch(() => {
        if (!cancelled) setCompositorError(true)
      })
    return () => {
      cancelled = true
    }
  }, [previewUrl, rgb.preset, H, W])

  useEffect(() => {
    if (shownPreviewFor !== rgb.preset) return undefined
    if (!composite.ok) {
      setCompositorError(true)
      return undefined
    }
    const current = displayRef.current
    if (current?.phase === 'client' && current.rgba === composite.rgba && current.preset === rgb.preset) return undefined
    const fromPreview = current?.phase === 'preview' && current.preset === rgb.preset
    let raf = 0
    let timer = 0
    const apply = () => {
      const latest = displayRef.current
      const fade = latest?.phase === 'preview' && latest.preset === rgb.preset && !reducedMotion
      setCompositorError(false)
      setPreviewLabel(Boolean(fade))
      setDisplay({
        rgba: composite.rgba,
        width: W,
        height: H,
        phase: 'client',
        fade: Boolean(fade),
        preset: rgb.preset,
      })
      if (fade) timer = window.setTimeout(() => setPreviewLabel(false), CROSSFADE_MS)
    }
    if (fromPreview) raf = requestAnimationFrame(apply)
    else apply()
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [shownPreviewFor, rgb.preset, composite, reducedMotion, W, H])

  const center = useMemo(
    () => worldToPixel(dataset.meta.center.ra_deg, dataset.meta.center.dec_deg, dataset.meta.grid),
    [dataset],
  )

  const drawOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, helpers: FrameOverlayHelpers) => {
      if (!center) return
      drawCrosshair(ctx, helpers, center.x, center.y)
    },
    [center],
  )

  const readoutRows = useCallback(
    (x: number, y: number): readonly ReadoutRow[] => {
      const index = y * W + x
      if (!combined.ok) {
        return [
          { label: rgbCopy.slotRed, value: rgbCopy.masked },
          { label: rgbCopy.slotGreen, value: rgbCopy.masked },
          { label: rgbCopy.slotBlue, value: rgbCopy.masked },
        ]
      }
      return [
        { label: rgbCopy.slotRed, value: formatSlot(combined.red, index) },
        { label: rgbCopy.slotGreen, value: formatSlot(combined.green, index) },
        { label: rgbCopy.slotBlue, value: formatSlot(combined.blue, index) },
      ]
    },
    [combined, W],
  )

  const image = useMemo((): CanvasImage | null => {
    if (!display) return null
    return { rgba: display.rgba, width: display.width, height: display.height }
  }, [display])

  const emptySlots: string[] = []
  if (members.blue.length === 0) emptySlots.push(rgbCopy.blueSlot)
  if (members.green.length === 0) emptySlots.push(rgbCopy.greenSlot)
  if (members.red.length === 0) emptySlots.push(rgbCopy.redSlot)

  const caption = previewLabel ? rgbCopy.serverPreview : rgbCopy.ariaLabel

  return (
    <div className="ws-blink">
      <div className="ws-seg liquid-glass-bar" role="radiogroup" aria-label={rgbCopy.presets}>
        {PRESET_CHOICES.map((choice) => {
          const later = choice.id === 'feature' || choice.id === 'custom'
          const detectorOff = choice.id === 'detector' && detectorRgb === null
          const disabled = later || detectorOff
          const tip = later ? rgbCopy.comingLater : detectorOff ? rgbCopy.needsDetectors : undefined
          return (
            <PresetButton
              key={choice.id}
              label={choice.label}
              selected={rgb.preset === choice.id}
              disabled={disabled}
              tip={tip}
              onSelect={() => {
                if (choice.id === 'detector' || choice.id === 'equal_channel') setRgb({ preset: choice.id })
              }}
            />
          )
        })}
      </div>
      {rgb.preset === 'detector' && detectorRgb ? (
        <p className="ws-caption font-mono tabular-nums text-zinc-800 dark:text-white/85">
          <span>{rgbGroupLine(detectorRgb.blue, detectorRgb.green, detectorRgb.red)}</span>
          <span>
            {rgbGroupSnr(
              formatSnr(detectorRgb.group_snr.blue),
              formatSnr(detectorRgb.group_snr.green),
              formatSnr(detectorRgb.group_snr.red),
              formatSnr(detectorRgb.min_group_snr),
            )}
          </span>
        </p>
      ) : null}
      <div className="ws-seg liquid-glass-bar" role="radiogroup" aria-label={rgbCopy.limits}>
        <button
          type="button"
          role="radio"
          aria-checked={!rgb.linked}
          className={rgb.linked ? undefined : 'liquid-glass-btn-active'}
          onClick={() => setRgb({ linked: false })}
        >
          {rgbCopy.perChannel}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={rgb.linked}
          className={rgb.linked ? 'liquid-glass-btn-active' : undefined}
          onClick={() => setRgb({ linked: true })}
        >
          {rgbCopy.linked}
        </button>
      </div>
      <div className="ws-blink-controls">
        <GainSlider label={rgbCopy.gainRed} value={rgb.gains.red} onChange={(red) => setRgb({ gains: { red } })} />
        <GainSlider label={rgbCopy.gainGreen} value={rgb.gains.green} onChange={(green) => setRgb({ gains: { green } })} />
        <GainSlider label={rgbCopy.gainBlue} value={rgb.gains.blue} onChange={(blue) => setRgb({ gains: { blue } })} />
      </div>
      {emptySlots.length > 0 || compositorError ? (
        <div className="ws-blink-controls">
          {emptySlots.map((slot) => (
            <span key={slot} className="inline-flex items-center gap-2 text-xs text-zinc-700 dark:text-white/80">
              {slot}
              <Chip>{rgbCopy.noSlotData}</Chip>
            </span>
          ))}
          {compositorError ? <Chip>{rgbCopy.compositorUnavailable}</Chip> : null}
        </div>
      ) : null}
      {previewLabel ? <p className="ws-caption text-zinc-700 dark:text-white/80">{rgbCopy.serverPreview}</p> : null}
      <p className="ws-caption text-zinc-600 dark:text-[#A1A1AA]">{rgbCopy.motionSmear}</p>
      {image ? (
        <FrameCanvas
          image={image}
          H={H}
          W={W}
          grid={dataset.meta.grid}
          pixelScaleArcsec={dataset.meta.grid.pixel_scale_arcsec}
          crossfadeMs={display?.fade ? CROSSFADE_MS : 0}
          readoutRows={readoutRows}
          drawOverlay={drawOverlay}
          ariaLabel={rgbCopy.ariaLabel}
          caption={caption}
        />
      ) : compositorError ? null : (
        <p className="ws-caption" role="status">
          {rgbCopy.loading}
        </p>
      )}
    </div>
  )
}
