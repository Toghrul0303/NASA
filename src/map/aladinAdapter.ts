/**
 * Aladin Lite v3 adapter. FRONTEND_SPEC §8.1–§8.4.
 * This is the only module that imports `aladin-lite`.
 */
import aladinLite from 'aladin-lite'
import { hipsSurveyCandidates } from '../config/env'
import { FOV_MAX_DEG, FOV_MIN_DEG } from '../config/constants'
import { gaiaPositionAtEpoch } from '../config/copy'
import { gaiaPopup } from './gaiaOverlay'

/** Keep aligned with `cubeLayer`'s 10 s probe. The adapter does not import that module. */
const CUBE_SLICE_TIMEOUT_MS = 10_000

/** Dichroic channels (DC §3.3). The slider in `cubeLayer` skips these; the adapter never requests them. */
function isDichroicCubeChannel(channel: number): boolean {
  return channel === 50 || channel === 51
}

export interface MapView {
  ra: number
  dec: number
  fov: number
}

/** One Gaia source drawn on the map. `sourceId` stays a string (DC §1, §8.3). */
export interface GaiaMapSource {
  sourceId: string
  raDeg: number
  decDeg: number
  refEpochYear: number
  isPrimary: boolean
  /** Verdict colour for the primary marker. Other sources use a fixed colour. */
  color?: string
  photGMeanMag: number | null
  parallaxMas: number | null
  pmraMasYr: number | null
  pmdecMasYr: number | null
  separationArcsec: number
}

/**
 * One vertex of the primary predicted track, in array order.
 * `label` is `epoch {epoch_id}`. Aladin polylines have no per-vertex text,
 * so each vertex is also a catalog source whose `label` column is drawn.
 */
export interface GaiaTrackPoint {
  raDeg: number
  decDeg: number
  label: string
}

/** HiPS cube layer. `channel` is the cube frame index (DC §3.3). `null` restores the base survey. */
export interface CubeConfig {
  url: string
  channel: number
}

export interface MapAdapter {
  init(el: HTMLElement, opts: { ra: number; dec: number; fov: number; survey: string }): Promise<void>
  gotoRaDec(ra: number, dec: number): void
  setFov(deg: number): void
  getView(): { ra: number; dec: number; fov: number }
  onViewChange(cb: (v: { ra: number; dec: number; fov: number }) => void): () => void
  onClick(cb: (ra: number, dec: number) => void): () => void
  setFootprint(poly: Array<[number, number]> | null): void
  setGaiaSources(src: GaiaMapSource[]): void
  setGaiaTrack(track: readonly GaiaTrackPoint[] | null): void
  setCube(cfg: CubeConfig | null): Promise<void>
  destroy(): void
}

/** Reported by `onSurveyStatus`. The §8.1 `MapAdapter` methods are unchanged. */
export type SurveyStatus = 'ready' | 'unavailable'

/** `resize` is the hook the map component's ResizeObserver uses to run Aladin's layout pass. */
export interface MapSurface extends MapAdapter {
  resize(): void
  onSurveyStatus(cb: (status: SurveyStatus) => void): () => void
  retrySurvey(): Promise<void>
  /**
   * Embed mode has no Aladin option for the logo link (`https://aladin.cds.unistra.fr/`,
   * `target="_blank"`, no `rel="noopener"`). Hide that chrome and drop any other
   * outbound anchor that is not a `target="_blank"` + `rel="noopener"` link-out.
   */
  setEmbedMode(on: boolean): void
}

interface AladinClick {
  x: number
  y: number
  isDragging?: boolean
}

interface AladinSource {
  x?: number
  y?: number
  data?: {
    is_primary?: boolean
    color?: string
  }
  setColor?: (color: string) => void
  setSize?: (size: number) => void
}

interface AladinCatalog {
  addSources(sources: AladinSource[]): void
  removeAll(): void
}

interface AladinOverlay {
  add(shape: unknown): void
  removeAll(): void
}

interface AladinHiPS {
  query: Promise<unknown>
  added: boolean
  slice: number
  cubeDepth?: number
  setSliceNumber(index: number): void
  getFrequency?: () => unknown
}

interface AladinView {
  fixLayoutDimensions?: () => void
  requestRedraw?: () => void
  resizeObserver?: { disconnect?: () => void }
}

interface AladinInstance {
  aladinDiv?: HTMLElement
  view?: AladinView
  gotoRaDec(ra: number, dec: number): void
  setFoV(fov: number): void
  getRaDec(): [number, number]
  getFoV(): [number, number]
  getSize?: () => [number, number]
  pix2world(x: number, y: number, frame?: string): [number, number] | undefined
  readCanvas?: (point: { x: number; y: number }) => unknown
  on(eventName: string, callback: (...args: unknown[]) => void): void
  addCatalog(catalog: AladinCatalog): void
  addOverlay(overlay: AladinOverlay): void
  removeOverlay(overlay: AladinCatalog | AladinOverlay): void
  setBaseImageLayer(layer: AladinHiPS | string): unknown
  getBaseImageLayer?: () => { layer?: string } | null
  removeImageLayer?: (layerId: string) => void
}

interface AladinStatic {
  init: Promise<void>
  aladin(el: HTMLElement, options: Record<string, unknown>): AladinInstance
  catalog(options: Record<string, unknown>): AladinCatalog
  source(ra: number, dec: number, data?: Record<string, unknown>, options?: Record<string, unknown>): AladinSource
  graphicOverlay(options?: Record<string, unknown>): AladinOverlay
  polygon(vertices: Array<[number, number]>, options?: Record<string, unknown>): unknown
  polyline(vertices: Array<[number, number]>, options?: Record<string, unknown>): unknown
  /** `v.imageHiPS` is `v.HiPS`: `(id, { name, url, errorCallback, ... })`. */
  imageHiPS(
    idOrUrl: string,
    options?: {
      name?: string
      url?: string
      cooFrame?: string
      maxOrder?: number
      errorCallback?: (reason: unknown) => void
    },
  ): AladinHiPS
}

const A = aladinLite as AladinStatic

/** Properties check before a candidate is handed to Aladin. */
const SURVEY_PROBE_MS = 5000

/**
 * Aladin's image-layer loader rethrows after `errorCallback`, which surfaces as an
 * unhandled rejection. Swallow only those HiPS failures. §15.6.
 */
let hipsRejectionGuardInstalled = false

function installHiPSRejectionGuard(): void {
  if (hipsRejectionGuardInstalled || typeof window === 'undefined') return
  hipsRejectionGuardInstalled = true
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason
    const text = typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : ''
    if (!text.startsWith('HiPS ')) return
    event.preventDefault()
  })
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** `null` when `<url>/properties` returns 200 within 5 s. Otherwise a short reason. */
async function probeHiPSProperties(url: string): Promise<string | null> {
  const root = url.endsWith('/') ? url.slice(0, -1) : url
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SURVEY_PROBE_MS)
  try {
    const response = await fetch(`${root}/properties`, { signal: controller.signal })
    if (response.status === 200) return null
    return `HTTP ${response.status}`
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'timed out after 5 s'
    if (error instanceof Error) return error.message
    return String(error)
  } finally {
    clearTimeout(timer)
  }
}

const GAIA_SOURCE_COLOR = '#56B4E9'
const GAIA_PRIMARY_COLOR = '#009E73'
const FOOTPRINT_COLOR = '#F0FF3C'
const TRACK_COLOR = '#F0E442'

export function clampMapView(view: { ra: number; dec: number; fov: number }): MapView {
  const ra = Number.isFinite(view.ra) ? ((view.ra % 360) + 360) % 360 : 0
  const dec = Number.isFinite(view.dec) ? Math.min(90, Math.max(-90, view.dec)) : 0
  const fov = Number.isFinite(view.fov) ? Math.min(FOV_MAX_DEG, Math.max(FOV_MIN_DEG, view.fov)) : FOV_MIN_DEG
  return { ra, dec, fov }
}

function formatTarget(ra: number, dec: number): string {
  return `${ra.toFixed(8)} ${dec.toFixed(8)}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isClickEvent(event: unknown): event is AladinClick {
  if (typeof event !== 'object' || event === null) return false
  const record = event as { x?: unknown; y?: unknown }
  return typeof record.x === 'number' && typeof record.y === 'number'
}

function finiteTrack(track: readonly GaiaTrackPoint[] | null): GaiaTrackPoint[] {
  if (!track) return []
  const points: GaiaTrackPoint[] = []
  for (const point of track) {
    if (!Number.isFinite(point.raDeg) || !Number.isFinite(point.decDeg)) continue
    points.push(point)
  }
  return points
}

function copyVertices(poly: readonly (readonly [number, number])[]): Array<[number, number]> {
  const vertices: Array<[number, number]> = []
  for (const pair of poly) {
    const ra = pair[0]
    const dec = pair[1]
    if (ra === undefined || dec === undefined || !Number.isFinite(ra) || !Number.isFinite(dec)) continue
    vertices.push([ra, dec])
  }
  return vertices
}

/** Screen-pixel marker: 8 px, or 12 px plus a ring for the primary. §8.3. */
function drawGaiaMarker(source: AladinSource, ctx: CanvasRenderingContext2D): void {
  if (typeof source.x !== 'number' || typeof source.y !== 'number') return
  const primary = source.data?.is_primary === true
  const color = typeof source.data?.color === 'string' ? source.data.color : GAIA_SOURCE_COLOR
  const radius = primary ? 6 : 4
  ctx.beginPath()
  ctx.arc(source.x, source.y, radius, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  if (!primary) return
  ctx.beginPath()
  ctx.arc(source.x, source.y, radius + 3, 0, Math.PI * 2)
  ctx.lineWidth = 2
  ctx.strokeStyle = color
  ctx.stroke()
}

function readFrequency(hips: AladinHiPS): number | null {
  if (typeof hips.getFrequency !== 'function') return null
  try {
    return finiteNumber(hips.getFrequency())
  } catch {
    return null
  }
}

function readCenterSample(aladin: AladinInstance): string | null {
  try {
    const size = aladin.getSize?.()
    const width = size?.[0]
    const height = size?.[1]
    if (typeof width !== 'number' || typeof height !== 'number' || width < 1 || height < 1) return null
    if (typeof aladin.readCanvas !== 'function') return null
    const value = aladin.readCanvas({ x: width / 2, y: height / 2 })
    if (value == null) return null
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function cubeDepthOf(hips: AladinHiPS): number | null {
  const depth = hips.cubeDepth
  if (typeof depth !== 'number' || !Number.isFinite(depth) || depth < 1) return null
  return depth
}

class AladinLiteAdapter implements MapSurface {
  private aladin: AladinInstance | null = null
  private host: HTMLElement | null = null
  private destroyed = false
  private current: MapView = { ra: 0, dec: 0, fov: FOV_MIN_DEG }
  private readonly viewListeners = new Set<(view: MapView) => void>()
  private readonly clickListeners = new Set<(ra: number, dec: number) => void>()
  private footprint: AladinOverlay | null = null
  private track: AladinOverlay | null = null
  private trackCatalog: AladinCatalog | null = null
  private gaiaCatalog: AladinCatalog | null = null
  private cubeLayer: AladinHiPS | null = null
  private cubeUrl: string | null = null
  private cubeAttached = false
  private cubeOp = 0
  private surveyCandidates: readonly string[] = []
  private baseSurveyUrl: string | null = null
  private surveyStatus: SurveyStatus | null = null
  private surveyAttempt = 0
  private embedMode = false
  private readonly surveyListeners = new Set<(status: SurveyStatus) => void>()

  private readonly onCopyClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest('[data-gaia-copy]')
    if (!(button instanceof HTMLButtonElement)) return
    const sourceId = button.dataset.gaiaCopy
    if (!sourceId) return
    event.preventDefault()
    event.stopPropagation()
    const clipboard = navigator.clipboard
    if (!clipboard) return
    void clipboard.writeText(sourceId).catch(() => undefined)
  }

  async init(el: HTMLElement, opts: { ra: number; dec: number; fov: number; survey: string }): Promise<void> {
    if (this.destroyed) return
    installHiPSRejectionGuard()
    this.host = el
    el.addEventListener('click', this.onCopyClick, true)
    const view = clampMapView(opts)
    this.current = view
    this.surveyCandidates = hipsSurveyCandidates(opts.survey)

    try {
      await A.init
      if (this.destroyed) return

      const chosen = await this.selectSurvey(this.surveyCandidates)
      if (this.destroyed) return
      this.baseSurveyUrl = chosen
      const survey = chosen ? this.createBaseHiPS(chosen) : []

      const aladin = A.aladin(el, {
        // An empty list skips Aladin's default registry id (`P/DSS2/color`).
        survey,
        fov: view.fov,
        target: formatTarget(view.ra, view.dec),
        cooFrame: 'ICRSd',
        backgroundColor: '#000000',
        showCooGrid: false,
        showFrame: false,
        showFullscreenControl: false,
        showStatusBar: false,
        showLayersControl: false,
        showShareControl: false,
        showSimbadPointerControl: false,
        showContextMenu: false,
        log: false,
      })
      if (this.destroyed) {
        el.replaceChildren()
        return
      }
      if (!aladin) throw new Error('Aladin did not start')

      this.aladin = aladin
      this.bindEvents(aladin)
      aladin.gotoRaDec(view.ra, view.dec)
      aladin.setFoV(view.fov)
      this.applyEmbedChrome()
      this.resize()
      this.publishSurvey(chosen ? 'ready' : 'unavailable')
    } catch (error) {
      console.info('[map] Interactive map unavailable', error)
      throw error
    }
  }

  onSurveyStatus(cb: (status: SurveyStatus) => void): () => void {
    this.surveyListeners.add(cb)
    if (this.surveyStatus) cb(this.surveyStatus)
    return () => {
      this.surveyListeners.delete(cb)
    }
  }

  async retrySurvey(): Promise<void> {
    const attempt = ++this.surveyAttempt
    try {
      const chosen = await this.selectSurvey(this.surveyCandidates)
      if (attempt !== this.surveyAttempt || this.destroyed) return
      this.applyBaseSurvey(chosen)
    } catch (error) {
      console.info('[map] Base survey failed:', error)
      if (attempt === this.surveyAttempt && !this.destroyed) this.publishSurvey('unavailable')
    }
  }

  setEmbedMode(on: boolean): void {
    this.embedMode = on
    this.applyEmbedChrome()
  }

  gotoRaDec(ra: number, dec: number): void {
    const next = clampMapView({ ra, dec, fov: this.current.fov })
    this.current = { ...this.current, ra: next.ra, dec: next.dec }
    this.aladin?.gotoRaDec(next.ra, next.dec)
  }

  setFov(deg: number): void {
    const next = clampMapView({ ra: this.current.ra, dec: this.current.dec, fov: deg })
    this.current = { ...this.current, fov: next.fov }
    this.aladin?.setFoV(next.fov)
  }

  getView(): MapView {
    const aladin = this.aladin
    if (!aladin) return this.current
    try {
      const radec = aladin.getRaDec()
      const fov = aladin.getFoV()
      const ra = radec[0]
      const dec = radec[1]
      if (ra === undefined || dec === undefined) return this.current
      return clampMapView({
        ra,
        dec,
        fov: Math.max(fov[0] ?? 0, fov[1] ?? 0),
      })
    } catch {
      return this.current
    }
  }

  onViewChange(cb: (v: MapView) => void): () => void {
    this.viewListeners.add(cb)
    return () => {
      this.viewListeners.delete(cb)
    }
  }

  onClick(cb: (ra: number, dec: number) => void): () => void {
    this.clickListeners.add(cb)
    return () => {
      this.clickListeners.delete(cb)
    }
  }

  setFootprint(poly: Array<[number, number]> | null): void {
    const aladin = this.aladin
    if (!aladin) return
    const vertices = poly === null ? [] : copyVertices(poly)
    if (vertices.length < 3) {
      this.detachOverlay(this.footprint)
      this.footprint = null
      return
    }
    const overlay = this.ensureOverlay(aladin, 'footprint')
    overlay.removeAll()
    overlay.add(A.polygon(vertices, { color: FOOTPRINT_COLOR, lineWidth: 2 }))
  }

  setGaiaSources(src: GaiaMapSource[]): void {
    const aladin = this.aladin
    if (!aladin) return
    if (src.length === 0) {
      this.detachOverlay(this.gaiaCatalog)
      this.gaiaCatalog = null
      return
    }
    if (!this.gaiaCatalog) {
      this.gaiaCatalog = A.catalog({
        name: 'Gaia',
        color: GAIA_SOURCE_COLOR,
        sourceSize: 8,
        // Aladin hides non-footprint sources when this stays at its default.
        onlyFootprints: false,
        shape: drawGaiaMarker,
        displayLabel: true,
        labelColumn: 'marker_label',
        labelColor: '#ffffff',
        labelFont: '11px sans-serif',
      })
      aladin.addCatalog(this.gaiaCatalog)
    }
    const catalog = this.gaiaCatalog
    catalog.removeAll()
    const markers: AladinSource[] = []
    for (const source of src) {
      const color = source.isPrimary ? (source.color ?? GAIA_PRIMARY_COLOR) : GAIA_SOURCE_COLOR
      const popup = gaiaPopup(source)
      const marker = A.source(
        source.raDeg,
        source.decDeg,
        {
          source_id: source.sourceId,
          is_primary: source.isPrimary,
          color,
          marker_label: gaiaPositionAtEpoch(source.refEpochYear),
        },
        {
          marker: true,
          popupTitle: popup.title,
          popupDesc: popup.html,
          useMarkerDefaultIcon: false,
        },
      )
      marker.setColor?.(color)
      marker.setSize?.(source.isPrimary ? 12 : 8)
      markers.push(marker)
    }
    catalog.addSources(markers)
  }

  setGaiaTrack(track: readonly GaiaTrackPoint[] | null): void {
    const aladin = this.aladin
    if (!aladin) return
    const points = finiteTrack(track)
    if (points.length === 0) {
      this.detachOverlay(this.track)
      this.track = null
      this.detachOverlay(this.trackCatalog)
      this.trackCatalog = null
      return
    }
    if (points.length >= 2) {
      const overlay = this.ensureOverlay(aladin, 'track')
      overlay.removeAll()
      overlay.add(
        A.polyline(
          points.map((point) => [point.raDeg, point.decDeg]),
          { color: TRACK_COLOR, lineWidth: 2 },
        ),
      )
    } else {
      this.detachOverlay(this.track)
      this.track = null
    }
    if (!this.trackCatalog) {
      this.trackCatalog = A.catalog({
        name: 'Gaia track',
        color: TRACK_COLOR,
        sourceSize: 6,
        onlyFootprints: false,
        shape: 'circle',
        displayLabel: true,
        labelColumn: 'label',
        labelColor: TRACK_COLOR,
        labelFont: '11px sans-serif',
      })
      aladin.addCatalog(this.trackCatalog)
    }
    const catalog = this.trackCatalog
    catalog.removeAll()
    catalog.addSources(
      points.map((point) =>
        A.source(point.raDeg, point.decDeg, { label: point.label }, { marker: false }),
      ),
    )
  }

  async setCube(cfg: CubeConfig | null): Promise<void> {
    const op = ++this.cubeOp
    if (cfg === null) {
      this.restoreSurvey()
      return
    }
    if (isDichroicCubeChannel(cfg.channel)) {
      throw new Error('Dichroic channel has no cube data')
    }
    if (!Number.isInteger(cfg.channel) || cfg.channel < 0 || cfg.channel > 101) {
      throw new Error('Cube channel is out of range')
    }
    const url = cfg.url.trim()
    if (url === '') throw new Error('HiPS cube URL is empty')

    const aladin = this.aladin
    if (!aladin) throw new Error('Map is not ready')

    try {
      const hips = await this.ensureCube(aladin, url, op)
      if (!hips || op !== this.cubeOp) return
      await this.applySlice(aladin, hips, cfg.channel, op)
    } catch (error) {
      if (op === this.cubeOp) this.restoreSurvey(true)
      throw error
    }
  }

  resize(): void {
    const view = this.aladin?.view
    if (!view || typeof view.fixLayoutDimensions !== 'function') return
    view.fixLayoutDimensions()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.cubeOp += 1
    this.surveyAttempt += 1
    this.viewListeners.clear()
    this.clickListeners.clear()
    this.surveyListeners.clear()
    const host = this.host
    const aladin = this.aladin
    this.host = null
    this.aladin = null
    this.footprint = null
    this.track = null
    this.trackCatalog = null
    this.gaiaCatalog = null
    this.cubeLayer = null
    this.cubeUrl = null
    this.cubeAttached = false
    if (host) host.removeEventListener('click', this.onCopyClick, true)
    try {
      aladin?.view?.resizeObserver?.disconnect?.()
    } catch {
      // The view is already gone.
    }
    if (host) {
      host.replaceChildren()
      host.classList.remove('aladin-container')
    }
  }

  private applyEmbedChrome(): void {
    const root = this.aladin?.aladinDiv ?? this.host
    if (!root) return
    const logo = root.querySelector('.aladin-logo-container')
    if (logo instanceof HTMLElement) {
      logo.hidden = this.embedMode
    }
    for (const node of root.querySelectorAll('a')) {
      if (!(node instanceof HTMLAnchorElement)) continue
      const allowed = node.target === '_blank' && node.rel.split(/\s+/).includes('noopener')
      if (this.embedMode && !allowed) {
        if (!node.dataset.embedHref && node.hasAttribute('href')) node.dataset.embedHref = node.href
        node.removeAttribute('href')
      } else if (!this.embedMode && node.dataset.embedHref) {
        node.href = node.dataset.embedHref
        delete node.dataset.embedHref
      }
    }
  }

  private bindEvents(aladin: AladinInstance): void {
    const emit = (): void => {
      const view = this.getView()
      this.current = view
      for (const listener of this.viewListeners) listener(view)
    }
    aladin.on('positionChanged', () => emit())
    aladin.on('zoomChanged', () => emit())
    aladin.on('click', (event: unknown) => {
      if (!isClickEvent(event) || event.isDragging) return
      const world = aladin.pix2world(event.x, event.y, 'icrs')
      if (!world) return
      const ra = world[0]
      const dec = world[1]
      if (ra === undefined || dec === undefined || !Number.isFinite(ra) || !Number.isFinite(dec)) return
      const view = clampMapView({ ra, dec, fov: this.current.fov })
      for (const listener of this.clickListeners) listener(view.ra, view.dec)
    })
  }

  private ensureOverlay(aladin: AladinInstance, kind: 'footprint' | 'track'): AladinOverlay {
    const existing = kind === 'footprint' ? this.footprint : this.track
    if (existing) return existing
    const overlay = A.graphicOverlay({
      name: kind === 'footprint' ? 'Footprint' : 'Gaia track',
      color: kind === 'footprint' ? FOOTPRINT_COLOR : TRACK_COLOR,
      lineWidth: 2,
    })
    aladin.addOverlay(overlay)
    if (kind === 'footprint') this.footprint = overlay
    else this.track = overlay
    return overlay
  }

  private detachOverlay(overlay: AladinCatalog | AladinOverlay | null): void {
    if (!overlay || !this.aladin) return
    try {
      this.aladin.removeOverlay(overlay)
    } catch {
      // The overlay was already removed with the view.
    }
  }

  private publishSurvey(status: SurveyStatus): void {
    if (this.destroyed) return
    this.surveyStatus = status
    for (const listener of this.surveyListeners) listener(status)
  }

  private async selectSurvey(candidates: readonly string[]): Promise<string | null> {
    if (candidates.length === 0) {
      console.info('[map] Base survey failed: no HiPS URLs configured')
      return null
    }
    for (const candidate of candidates) {
      if (this.destroyed) return null
      if (!isAbsoluteHttpUrl(candidate)) {
        console.info(`[map] Base survey failed: ${candidate}: not a HiPS URL`)
        continue
      }
      try {
        const failure = await probeHiPSProperties(candidate)
        if (failure === null) {
          console.info(`[map] Base survey chosen: ${candidate}`)
          return candidate
        }
        console.info(`[map] Base survey failed: ${candidate}: ${failure}`)
      } catch (error) {
        console.info(`[map] Base survey failed: ${candidate}:`, error)
      }
    }
    return null
  }

  /** `A.imageHiPS(url, { url, errorCallback })` then the caller sets it as the base layer. */
  private createBaseHiPS(url: string): AladinHiPS {
    const hips = A.imageHiPS(url, {
      name: 'DSS2 color',
      url,
      errorCallback: (reason: unknown) => {
        console.info('[map] Base survey failed:', url, reason)
        if (this.destroyed || this.baseSurveyUrl !== url) return
        this.baseSurveyUrl = null
        this.publishSurvey('unavailable')
      },
    })
    void hips.query.catch(() => undefined)
    return hips
  }

  private applyBaseSurvey(url: string | null): void {
    this.baseSurveyUrl = url
    const aladin = this.aladin
    if (!aladin || !url) {
      this.clearBaseLayer()
      this.publishSurvey('unavailable')
      return
    }
    try {
      aladin.setBaseImageLayer(this.createBaseHiPS(url))
      this.publishSurvey('ready')
    } catch (error) {
      console.info('[map] Base survey failed:', url, error)
      this.baseSurveyUrl = null
      this.publishSurvey('unavailable')
    }
  }

  private clearBaseLayer(): void {
    const aladin = this.aladin
    if (!aladin) return
    try {
      const current = aladin.getBaseImageLayer?.()
      const layerId = current?.layer
      if (typeof layerId === 'string') aladin.removeImageLayer?.(layerId)
    } catch (error) {
      console.info('[map] Base survey was not restored', error)
    }
  }

  private restoreSurvey(discardLayer = false): void {
    this.cubeAttached = false
    if (discardLayer) {
      this.cubeLayer = null
      this.cubeUrl = null
    }
    if (this.baseSurveyUrl) {
      this.applyBaseSurvey(this.baseSurveyUrl)
      return
    }
    this.clearBaseLayer()
  }

  private async ensureCube(aladin: AladinInstance, url: string, op: number): Promise<AladinHiPS | null> {
    if (this.cubeLayer && this.cubeUrl === url) {
      if (!this.cubeAttached && op === this.cubeOp) {
        aladin.setBaseImageLayer(this.cubeLayer)
        this.cubeAttached = true
      }
      await this.cubeLayer.query
      if (op !== this.cubeOp) return null
      await this.waitUntilAdded(this.cubeLayer, op)
      return op === this.cubeOp ? this.cubeLayer : null
    }

    const hips = A.imageHiPS(url, {
      name: 'SPHEREx cube',
      url,
      errorCallback: (reason: unknown) => {
        console.info('[map] Cube control disabled', reason)
      },
    })
    void hips.query.catch(() => undefined)
    this.cubeLayer = hips
    this.cubeUrl = url
    try {
      await hips.query
    } catch (error) {
      if (op === this.cubeOp) this.restoreSurvey(true)
      throw error
    }
    if (op !== this.cubeOp) return null
    if (cubeDepthOf(hips) === null) throw new Error('HiPS cube depth is missing')
    aladin.setBaseImageLayer(hips)
    this.cubeAttached = true
    await this.waitUntilAdded(hips, op)
    return op === this.cubeOp ? hips : null
  }

  private async waitUntilAdded(hips: AladinHiPS, op: number): Promise<void> {
    const deadline = Date.now() + CUBE_SLICE_TIMEOUT_MS
    while (!hips.added) {
      if (op !== this.cubeOp) return
      if (Date.now() > deadline) throw new Error('HiPS cube layer was not added')
      await sleep(50)
    }
  }

  private async applySlice(aladin: AladinInstance, hips: AladinHiPS, channel: number, op: number): Promise<void> {
    const depth = cubeDepthOf(hips)
    if (depth === null || channel >= depth) throw new Error('HiPS cube does not include this slice')
    if (op !== this.cubeOp) return
    if (hips.slice === channel && hips.added) {
      aladin.view?.requestRedraw?.()
      await sleep(32)
      return
    }

    const before = {
      frequency: readFrequency(hips),
      sample: readCenterSample(aladin),
    }
    const deadline = Date.now() + CUBE_SLICE_TIMEOUT_MS
    while (Date.now() <= deadline) {
      if (op !== this.cubeOp) return
      if (hips.slice !== channel) hips.setSliceNumber(channel)
      if (hips.slice === channel) {
        const frequency = readFrequency(hips)
        const sample = readCenterSample(aladin)
        const frequencyChanged = frequency !== null && frequency !== before.frequency
        const sampleChanged = sample !== null && sample !== before.sample
        if (frequencyChanged || sampleChanged) {
          aladin.view?.requestRedraw?.()
          await sleep(32)
          return
        }
      }
      aladin.view?.requestRedraw?.()
      await sleep(50)
    }
    if (op !== this.cubeOp) return
    throw new Error('HiPS cube slice change did not re-render')
  }
}

export function createMapAdapter(): MapSurface {
  return new AladinLiteAdapter()
}
