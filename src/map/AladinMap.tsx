import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { env } from '../config/env'
import { cubeBandReadout, cubeWavelengthLabel, mapCopy } from '../config/copy'
import type { Gaia } from '../contract/types'
import { clampMapView, createMapAdapter, type MapSurface, type MapView } from './aladinAdapter'
import { syncGaiaOverlay } from './gaiaOverlay'

type CubeModule = typeof import('./cubeLayer')

export interface MapTargetOption {
  id: string
  label: string
  ra: number
  dec: number
}

export interface CubeWavelength {
  lambdaUm: number
  bandwidthUm: number | null
}

export interface AladinMapProps {
  ra?: number
  dec?: number
  fov?: number
  survey?: string
  targets?: readonly MapTargetOption[]
  /** Present once a dataset is loaded. `meta.channels` is constant, so any dataset can supply it. */
  cubeWavelength?: CubeWavelength | null
  /** Grid boundary in degrees. Null clears the polygon. */
  footprint?: Array<[number, number]> | null
  /** Delivered Gaia document. Null clears the overlay. */
  gaia?: Gaia | null
  /** Layer switch. On by default only when `query_status` is `ok`. */
  gaiaLayerEnabled?: boolean
  gaiaLayerOn?: boolean
  onGaiaLayerChange?: (on: boolean) => void
  onViewChange?: (view: MapView) => void
  onClick?: (ra: number, dec: number) => void
  onTargetSelect?: (target: MapTargetOption) => void
}

const DEFAULT_VIEW: MapView = { ra: 0, dec: 0, fov: 0.5 }

function sameView(a: MapView, b: MapView): boolean {
  return Math.abs(a.ra - b.ra) < 1e-6 && Math.abs(a.dec - b.dec) < 1e-6 && Math.abs(a.fov - b.fov) < 1e-6
}

/**
 * Sky map. A ResizeObserver calls Aladin's layout pass.
 * If WebGL is missing, the map is replaced by a coordinate form and a target picker. §8.2.
 * The Cube control is mounted only after Gate G1's probe succeeds, and `cubeLayer` is not loaded otherwise. §8.4.
 */
export function AladinMap({
  ra,
  dec,
  fov,
  survey,
  targets = [],
  cubeWavelength = null,
  footprint = null,
  gaia = null,
  gaiaLayerEnabled = false,
  gaiaLayerOn = false,
  onGaiaLayerChange,
  onViewChange,
  onClick,
  onTargetSelect,
}: AladinMapProps) {
  const [internal, setInternal] = useState<MapView>(DEFAULT_VIEW)
  const view: MapView = {
    ra: ra ?? internal.ra,
    dec: dec ?? internal.dec,
    fov: fov ?? internal.fov,
  }
  const viewRef = useRef(view)
  viewRef.current = view
  const onViewChangeRef = useRef(onViewChange)
  onViewChangeRef.current = onViewChange
  const onClickRef = useRef(onClick)
  onClickRef.current = onClick
  const onTargetSelectRef = useRef(onTargetSelect)
  onTargetSelectRef.current = onTargetSelect

  const frameRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<MapSurface | null>(null)
  const overlayRef = useRef({ footprint, gaia, showGaia: gaiaLayerEnabled && gaiaLayerOn })
  overlayRef.current = { footprint, gaia, showGaia: gaiaLayerEnabled && gaiaLayerOn }
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading')
  const [cube, setCube] = useState<CubeModule | null>(null)
  const [surveyUnavailable, setSurveyUnavailable] = useState(false)
  const [surveyRetrying, setSurveyRetrying] = useState(false)

  function publish(next: MapView): void {
    const clamped = clampMapView(next)
    setInternal((current) => (sameView(current, clamped) ? current : clamped))
    onViewChangeRef.current?.(clamped)
  }

  const publishRef = useRef(publish)
  publishRef.current = publish

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const observer = new ResizeObserver(() => {
      adapterRef.current?.resize()
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const adapter = createMapAdapter()
    adapterRef.current = adapter
    let cancelled = false
    const initial = viewRef.current
    void adapter
      .init(el, {
        ra: initial.ra,
        dec: initial.dec,
        fov: initial.fov,
        survey: survey ?? env.hipsSurveyBase,
      })
      .then(() => {
        if (cancelled) return
        const overlay = overlayRef.current
        adapter.setFootprint(overlay.footprint)
        syncGaiaOverlay(adapter, overlay.gaia, overlay.showGaia)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        console.info('[map] Interactive map unavailable', error)
        adapter.destroy()
        if (adapterRef.current === adapter) adapterRef.current = null
        if (!cancelled) setStatus('fallback')
      })
    return () => {
      cancelled = true
      adapter.destroy()
      if (adapterRef.current === adapter) adapterRef.current = null
    }
  }, [survey])

  useEffect(() => {
    const adapter = adapterRef.current
    if (!adapter || status !== 'ready') return
    const offSurvey = adapter.onSurveyStatus((next) => {
      setSurveyUnavailable(next === 'unavailable')
    })
    const offView = adapter.onViewChange((next) => {
      publishRef.current(next)
    })
    const offClick = adapter.onClick((nextRa, nextDec) => {
      onClickRef.current?.(nextRa, nextDec)
    })
    return () => {
      offSurvey()
      offView()
      offClick()
    }
  }, [status])

  useEffect(() => {
    const adapter = adapterRef.current
    if (!adapter || status !== 'ready') return
    const current = adapter.getView()
    if (Math.abs(current.ra - view.ra) >= 1e-5 || Math.abs(current.dec - view.dec) >= 1e-5) {
      adapter.gotoRaDec(view.ra, view.dec)
    }
    if (Math.abs(current.fov - view.fov) >= 1e-5) adapter.setFov(view.fov)
  }, [view.ra, view.dec, view.fov, status])

  useEffect(() => {
    const adapter = adapterRef.current
    if (!adapter || status !== 'ready') return
    adapter.setFootprint(footprint)
  }, [footprint, status])

  useEffect(() => {
    const adapter = adapterRef.current
    if (!adapter || status !== 'ready') return
    syncGaiaOverlay(adapter, gaia, gaiaLayerEnabled && gaiaLayerOn)
  }, [gaia, gaiaLayerEnabled, gaiaLayerOn, status])

  useEffect(() => {
    if (status !== 'ready' || !env.featureG1Cube) return
    const adapter = adapterRef.current
    if (!adapter) return
    let cancelled = false
    void import('./cubeLayer')
      .then(async (mod) => {
        if (cancelled) return false
        const available = await mod.probe(adapter)
        if (cancelled || !available) return false
        setCube(mod)
        return true
      })
      .catch((error: unknown) => {
        console.info('[map] Cube control disabled', error)
      })
    return () => {
      cancelled = true
    }
  }, [status])

  return (
    <div ref={frameRef} className="relative h-full min-h-0 w-full overflow-hidden bg-black">
      {status === 'fallback' ? (
        <CoordinateFallback
          view={view}
          targets={targets}
          onViewChange={publish}
          onTargetSelect={(target) => onTargetSelectRef.current?.(target)}
        />
      ) : (
        <div ref={hostRef} className="h-full w-full" role="application" aria-label={mapCopy.mapLabel} />
      )}
      {status === 'ready' && surveyUnavailable ? (
        <div
          role="status"
          className="pointer-events-auto absolute left-1/2 top-3 z-20 w-[min(100%-1.5rem,36rem)] -translate-x-1/2 rounded-lg border border-border bg-black/85 px-3 py-2 text-sm text-white"
        >
          <p>Base sky survey unavailable. Positions and overlays still work.</p>
          <button
            type="button"
            className="mt-2 rounded-full bg-accent px-3 py-1 text-sm font-medium text-black disabled:opacity-60"
            disabled={surveyRetrying}
            onClick={() => {
              const adapter = adapterRef.current
              if (!adapter) return
              setSurveyRetrying(true)
              void adapter.retrySurvey().finally(() => setSurveyRetrying(false))
            }}
          >
            Retry
          </button>
        </div>
      ) : null}
      {status === 'ready' ? (
        <div className="ws-map-toolbar">
          <label className="ws-map-layer">
            <input
              type="checkbox"
              checked={gaiaLayerEnabled && gaiaLayerOn}
              disabled={!gaiaLayerEnabled}
              onChange={(event) => onGaiaLayerChange?.(event.target.checked)}
            />
            {mapCopy.gaiaLayer}
          </label>
        </div>
      ) : null}
      {status === 'ready' && cube ? (
        <CubeControl cube={cube} wavelength={cubeWavelength} onDisable={() => setCube(null)} adapterRef={adapterRef} />
      ) : null}
    </div>
  )
}

function CoordinateFallback({
  view,
  targets,
  onViewChange,
  onTargetSelect,
}: {
  view: MapView
  targets: readonly MapTargetOption[]
  onViewChange: (view: MapView) => void
  onTargetSelect: (target: MapTargetOption) => void
}) {
  const id = useId()
  const [raText, setRaText] = useState(String(view.ra))
  const [decText, setDecText] = useState(String(view.dec))
  const [fovText, setFovText] = useState(String(view.fov))
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    setRaText(String(view.ra))
    setDecText(String(view.dec))
    setFovText(String(view.fov))
  }, [view.ra, view.dec, view.fov])

  const selectedId =
    targets.find((target) => Math.abs(target.ra - view.ra) < 1e-4 && Math.abs(target.dec - view.dec) < 1e-4)?.id ?? ''

  function apply(next: { ra: number; dec: number; fov: number }): void {
    setInvalid(false)
    onViewChange(clampMapView(next))
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const nextRa = Number(raText)
    const nextDec = Number(decText)
    const nextFov = Number(fovText)
    if (!Number.isFinite(nextRa) || !Number.isFinite(nextDec) || !Number.isFinite(nextFov)) {
      setInvalid(true)
      return
    }
    apply({ ra: nextRa, dec: nextDec, fov: nextFov })
  }

  function chooseTarget(targetId: string): void {
    const target = targets.find((entry) => entry.id === targetId)
    if (!target) return
    const nextFov = Number(fovText)
    apply({ ra: target.ra, dec: target.dec, fov: Number.isFinite(nextFov) ? nextFov : view.fov })
    onTargetSelect(target)
  }

  const fieldClass = 'mt-1 w-full rounded-md border border-input bg-black px-3 py-2 font-mono text-sm text-white'

  return (
    <form className="flex h-full w-full items-center justify-center p-6" onSubmit={onSubmit} autoComplete="off">
      <fieldset className="w-full max-w-md rounded-lg border border-border bg-muted p-5">
        <legend className="px-2 text-sm text-muted-foreground">{mapCopy.coordinateFormLabel}</legend>
        <div className="space-y-4">
          <label className="block text-sm" htmlFor={`${id}-ra`}>
            {mapCopy.ra}
            <input
              id={`${id}-ra`}
              className={fieldClass}
              inputMode="decimal"
              value={raText}
              onChange={(event) => setRaText(event.target.value)}
            />
          </label>
          <label className="block text-sm" htmlFor={`${id}-dec`}>
            {mapCopy.dec}
            <input
              id={`${id}-dec`}
              className={fieldClass}
              inputMode="decimal"
              value={decText}
              onChange={(event) => setDecText(event.target.value)}
            />
          </label>
          <label className="block text-sm" htmlFor={`${id}-fov`}>
            {mapCopy.fov}
            <input
              id={`${id}-fov`}
              className={fieldClass}
              inputMode="decimal"
              value={fovText}
              onChange={(event) => setFovText(event.target.value)}
            />
          </label>
          <label className="block text-sm" htmlFor={`${id}-target`}>
            {mapCopy.target}
            <select
              id={`${id}-target`}
              className={fieldClass}
              value={selectedId}
              onChange={(event) => chooseTarget(event.target.value)}
            >
              <option value="">{mapCopy.targetPlaceholder}</option>
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}
                </option>
              ))}
            </select>
          </label>
          {invalid ? (
            <p role="status" className="text-sm text-white">
              {mapCopy.invalidCoordinates}
            </p>
          ) : null}
          <button type="submit" className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-black">
            {mapCopy.apply}
          </button>
        </div>
      </fieldset>
    </form>
  )
}

function CubeControl({
  cube,
  wavelength,
  adapterRef,
  onDisable,
}: {
  cube: CubeModule
  wavelength: CubeWavelength | null
  adapterRef: { current: MapSurface | null }
  onDisable: () => void
}) {
  const id = useId()
  const [channel, setChannel] = useState(0)
  const [enabled, setEnabled] = useState(false)
  const [dichroicNote, setDichroicNote] = useState(false)
  const requestRef = useRef(0)
  const { band, bandChannel } = cube.bandAndChannel(channel)
  const readout = cubeBandReadout(band, bandChannel)
  const wavelengthLabel = wavelength ? cubeWavelengthLabel(wavelength.lambdaUm, wavelength.bandwidthUm) : null

  async function apply(nextChannel: number, on: boolean): Promise<void> {
    const request = ++requestRef.current
    const adapter = adapterRef.current
    const hipsUrl = env.spherexCubeHipsUrl
    if (!adapter || !hipsUrl) {
      console.info('[map] Cube control disabled')
      if (request === requestRef.current) onDisable()
      return
    }
    try {
      if (on) await adapter.setCube({ url: hipsUrl, channel: nextChannel })
      else await adapter.setCube(null)
    } catch (error: unknown) {
      if (request !== requestRef.current) return
      console.info('[map] Cube control disabled', error)
      onDisable()
      try {
        await adapter.setCube(null)
      } catch {
        // The control is already removed.
      }
    }
  }

  function selectChannel(next: number, crossedDichroic: boolean): void {
    setDichroicNote(crossedDichroic)
    setChannel(next)
    if (enabled) void apply(next, true)
  }

  return (
    <section
      className="absolute bottom-3 left-3 z-10 w-[min(100%-1.5rem,22rem)] rounded-lg border border-border bg-black/85 p-3 text-sm text-white"
      aria-label={mapCopy.cubeToggle}
    >
      <div className="flex items-start justify-between gap-3">
        <label className="inline-flex items-center gap-2" htmlFor={`${id}-toggle`}>
          <input
            id={`${id}-toggle`}
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              const on = event.target.checked
              setEnabled(on)
              void apply(channel, on)
            }}
          />
          {mapCopy.cubeToggle}
        </label>
        <p className="text-right font-mono text-xs leading-5">
          {readout}
          {wavelengthLabel ? <span className="block">{wavelengthLabel}</span> : null}
        </p>
      </div>
      <label className="mt-3 block text-xs text-muted-foreground" htmlFor={`${id}-channel`}>
        {mapCopy.channelSlider}
        <input
          id={`${id}-channel`}
          className="mt-1 w-full"
          type="range"
          min={0}
          max={101}
          step={1}
          value={channel}
          aria-valuetext={wavelengthLabel ? `${readout}, ${wavelengthLabel}` : readout}
          onChange={(event) => {
            const raw = Number(event.target.value)
            const resolved = cube.resolveChannelInput(raw)
            if (!resolved.ok) {
              if (!resolved.dichroic) return
              const direction = raw >= channel ? 1 : -1
              const stepped = cube.stepValidChannel(channel, direction)
              selectChannel(stepped.channel, true)
              return
            }
            selectChannel(resolved.channel, false)
          }}
          onKeyDown={(event) => {
            if (
              event.key !== 'ArrowRight' &&
              event.key !== 'ArrowUp' &&
              event.key !== 'ArrowLeft' &&
              event.key !== 'ArrowDown'
            ) {
              return
            }
            event.preventDefault()
            const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1
            const stepped = cube.stepValidChannel(channel, direction)
            selectChannel(stepped.channel, stepped.crossedDichroic)
          }}
        />
      </label>
      <label className="mt-2 block text-xs text-muted-foreground" htmlFor={`${id}-index`}>
        Index
        <input
          id={`${id}-index`}
          className="mt-1 w-24 rounded-md border border-input bg-black px-2 py-1 font-mono text-sm text-white"
          type="number"
          inputMode="numeric"
          min={0}
          max={101}
          value={channel}
          onChange={(event) => {
            const resolved = cube.resolveChannelInput(Number(event.target.value))
            if (!resolved.ok) {
              setDichroicNote(resolved.dichroic)
              return
            }
            selectChannel(resolved.channel, false)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            event.preventDefault()
            const direction = event.key === 'ArrowUp' ? 1 : -1
            const stepped = cube.stepValidChannel(channel, direction)
            selectChannel(stepped.channel, stepped.crossedDichroic)
          }}
        />
      </label>
      {dichroicNote ? (
        <p role="status" className="mt-2 text-xs">
          {mapCopy.dichroicChannel}
        </p>
      ) : null}
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{mapCopy.cubeDisclosure}</p>
    </section>
  )
}
