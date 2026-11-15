/**
 * Workspace store. FRONTEND_SPEC §4.2.
 * A dataset is replaced as a whole and is not mutated after `ready`.
 */
import { create } from 'zustand'
import { ZOOM_MIN } from '../config/constants'
import type { ToolId } from '../config/tools'
import type { Detector, Frame } from '../contract/types'
import { ContractError, type ContractErrorCode } from '../contract/validate'
import {
  DETECTORS,
  defaultDetector,
  defaultLambda0,
  enabledDetectors,
  FPS_DEFAULT,
  FPS_MAX,
  FPS_MIN,
  K_DEFAULT,
  K_MAX,
  K_MIN,
  selectEpochCoadds,
  selectFrames,
  type BlinkMode,
} from '../core/blink'
import { clampRgbGain, type RgbGains, type RgbMemberPreset } from '../core/rgb'
import type { Dataset } from '../data/dataset'
import { loadDataset as fetchDataset } from '../data/loader'
import { applyTheme, initialTheme, prefersReducedMotion, writeStoredTheme, type ThemeName } from '../ui/theme'

export interface FrameViewport {
  zoom: number
  panX: number
  panY: number
}

export interface ViewState {
  ra: number
  dec: number
  fov: number
}

/** Grid position the frame canvas recentres on. Set from a Gaia source row. */
export interface FrameFocus {
  x: number
  y: number
}

export type DatasetLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface DatasetState {
  slug: string | null
  status: DatasetLoadStatus
  dataset: Dataset | null
  errorCode: ContractErrorCode | null
}

export type BlinkSpacing = 'frame' | 'time'

export interface BlinkOverlays {
  predicted: boolean
  apertures: boolean
  annulus: boolean
  centroid: boolean
  trail: boolean
  gaia: boolean
}

export interface BlinkState {
  mode: BlinkMode
  detector: Detector
  lambda0: number
  /** Half-width factor. Default 1, clamped to 0.25–3. */
  k: number
  itemIndex: number
  playing: boolean
  /** Frames per second, clamped to 1–10. Default 2, or 1 when reduced motion is set. */
  fps: number
  loop: boolean
  overlays: BlinkOverlays
  spacing: BlinkSpacing
}

/** Fields of `setBlink`. Overlay keys merge; omitted keys stay as they are. */
export type BlinkPatch = Partial<Omit<BlinkState, 'overlays'>> & {
  overlays?: Partial<BlinkOverlays>
}

export type SedViewId = 'sed' | 'lambdaTime'

export type SedTimeAxis = 'compressed' | 'true'

/** Wavelength window shared with Blink. Initialised from the Blink state on dataset load. */
export interface SedBand {
  lambda0: number
  k: number
}

/** SED / lambda-time controls. Reset when the dataset changes. §13. */
export interface SedState {
  view: SedViewId
  /** Index into `sed.aperture_radii_px`. Default `primary_aperture_index`. */
  aperture: number
  hideFlagged: boolean
  /** Detectors left on. Absent detectors stay disabled in the control. */
  detectors: Detector[]
  hiddenEpochs: number[]
  /** One epoch, or null for every epoch that is not hidden. */
  epochSlice: number | null
  logX: boolean
  asinhY: boolean
  /** Spectral line markers. On by default. */
  showLines: boolean
  timeAxis: SedTimeAxis
  band: SedBand
}

export type SedPatch = Partial<SedState>

/** False-colour RGB controls. Reset when the dataset changes. §12. */
export interface RgbState {
  preset: RgbMemberPreset
  /** False is per-channel limits. True uses the min low and max high. */
  linked: boolean
  gains: RgbGains
}

export type RgbPatch = {
  preset?: RgbMemberPreset
  linked?: boolean
  gains?: Partial<RgbGains>
}

export interface ToolState {
  tool: ToolId
  frame: FrameViewport
  blink: BlinkState
  sed: SedState
  rgb: RgbState
}

export interface JobState {
  status: 'idle'
}

export interface ToastMessage {
  id: number
  message: string
}

export interface UiState {
  embed: boolean
  reducedMotion: boolean
  theme: ThemeName
  toasts: readonly ToastMessage[]
}

interface WorkspaceStore {
  view: ViewState
  /** Latest source the Gaia table asked the canvas to centre on. A new object each time. */
  frameFocus: FrameFocus | null
  /** Gaia map layer. Turned on when a dataset with `query_status == "ok"` loads. */
  gaiaLayer: boolean
  tool: ToolState
  dataset: DatasetState
  job: JobState
  ui: UiState
  setView: (view: ViewState) => void
  setFrameFocus: (focus: FrameFocus) => void
  setGaiaLayer: (on: boolean) => void
  setTool: (tool: ToolId) => void
  setFrame: (frame: FrameViewport) => void
  setBlink: (partial: BlinkPatch) => void
  setSed: (partial: SedPatch) => void
  setRgb: (partial: RgbPatch) => void
  stepBlink: (delta: number) => void
  /** Point the frames blink at one `frames.json` row and open the Blink tool. */
  openFrameInBlink: (frameIndex: number) => void
  setEmbed: (embed: boolean) => void
  setTheme: (theme: ThemeName) => void
  pushToast: (message: string) => void
  dismissToast: (id: number) => void
  /**
   * `recenter` defaults to true (a user picked this dataset).
   * URL boot passes false when `ra` and `dec` are already in the query.
   */
  loadDataset: (slug: string, options?: { recenter?: boolean }) => Promise<void>
}

const DEFAULT_FOV_DEG = 0.5

const initialFrame = (): FrameViewport => ({ zoom: ZOOM_MIN, panX: 0, panY: 0 })

const DEFAULT_OVERLAYS: BlinkOverlays = {
  predicted: true,
  apertures: true,
  annulus: false,
  centroid: true,
  trail: false,
  gaia: true,
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  if (value < min) return min
  if (value > max) return max
  return value
}

function clampFps(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(FPS_MAX, Math.max(FPS_MIN, Math.round(value)))
}

/** Defaults for a frame list. Playback stays stopped until the Blink tool opens. */
export function blinkForFrames(frames: readonly Frame[], reducedMotion: boolean): BlinkState {
  const detector = defaultDetector(frames)
  const lambda0 = defaultLambda0(frames, detector, K_DEFAULT)
  return {
    mode: 'frames',
    detector,
    lambda0: Number.isFinite(lambda0) ? lambda0 : 0,
    k: K_DEFAULT,
    itemIndex: 0,
    playing: false,
    fps: reducedMotion ? FPS_MIN : FPS_DEFAULT,
    loop: true,
    overlays: { ...DEFAULT_OVERLAYS },
    spacing: 'frame',
  }
}

function initialSedState(blink: BlinkState): SedState {
  return {
    view: 'sed',
    aperture: 0,
    hideFlagged: false,
    detectors: [...DETECTORS],
    hiddenEpochs: [],
    epochSlice: null,
    logX: false,
    asinhY: false,
    showLines: true,
    timeAxis: 'compressed',
    band: { lambda0: blink.lambda0, k: blink.k },
  }
}

/** Detector when that preset exists, otherwise equal-channel. Gains start at 1 and limits are per channel. */
export function rgbStateFor(dataset: Dataset | null): RgbState {
  const detector = dataset?.coadds.rgb_presets?.detector_rgb
  return {
    preset: detector ? 'detector' : 'equal_channel',
    linked: false,
    gains: { red: 1, green: 1, blue: 1 },
  }
}

function applyRgb(current: RgbState, partial: RgbPatch): RgbState {
  const gains = { ...current.gains, ...partial.gains }
  return {
    preset: partial.preset ?? current.preset,
    linked: partial.linked ?? current.linked,
    gains: {
      red: clampRgbGain(gains.red),
      green: clampRgbGain(gains.green),
      blue: clampRgbGain(gains.blue),
    },
  }
}

/** Fresh SED controls for a loaded dataset. The band copies the Blink window. */
export function sedStateFor(dataset: Dataset, blink: BlinkState): SedState {
  const present = enabledDetectors(dataset.frames.epochs)
  const aperture = dataset.sed?.primary_aperture_index ?? 0
  return {
    ...initialSedState(blink),
    aperture,
    detectors: present.length > 0 ? [...present] : [...DETECTORS],
  }
}

function selectionLength(dataset: Dataset, blink: BlinkState): number {
  if (blink.mode === 'epochs') return selectEpochCoadds(dataset.coadds.coadds, blink.detector).length
  return selectFrames(dataset.frames.frames, blink.detector, blink.lambda0, blink.k).length
}

function mergeBlink(current: BlinkState, partial: BlinkPatch): BlinkState {
  const overlays = partial.overlays ? { ...current.overlays, ...partial.overlays } : current.overlays
  return {
    ...current,
    ...partial,
    overlays,
    k: clampNumber(partial.k ?? current.k, K_MIN, K_MAX, current.k),
    fps: clampFps(partial.fps ?? current.fps, current.fps),
  }
}

function clampItemIndex(dataset: Dataset | null, blink: BlinkState): BlinkState {
  if (!dataset) return { ...blink, itemIndex: 0 }
  const count = selectionLength(dataset, blink)
  if (count <= 0) return { ...blink, itemIndex: 0 }
  const raw = Number.isFinite(blink.itemIndex) ? Math.trunc(blink.itemIndex) : 0
  return { ...blink, itemIndex: Math.min(count - 1, Math.max(0, raw)) }
}

let loadController: AbortController | null = null
let loadGeneration = 0
let toastId = 0

function watchReducedMotion(set: (partial: (state: WorkspaceStore) => Partial<WorkspaceStore>) => void): void {
  if (typeof matchMedia !== 'function') return
  const query = matchMedia('(prefers-reduced-motion: reduce)')
  const apply = () => {
    set((state) => ({ ui: { ...state.ui, reducedMotion: query.matches } }))
  }
  if (typeof query.addEventListener === 'function') query.addEventListener('change', apply)
}

const bootTheme = initialTheme()
applyTheme(bootTheme)
const bootReducedMotion = prefersReducedMotion()
const bootBlink = blinkForFrames([], bootReducedMotion)
const bootRgb = rgbStateFor(null)

export const useWorkspaceStore = create<WorkspaceStore>()((set) => ({
  view: { ra: 0, dec: 0, fov: DEFAULT_FOV_DEG },
  frameFocus: null,
  gaiaLayer: false,
  tool: { tool: 'map', frame: initialFrame(), blink: bootBlink, sed: initialSedState(bootBlink), rgb: bootRgb },
  dataset: { slug: null, status: 'idle', dataset: null, errorCode: null },
  job: { status: 'idle' },
  ui: {
    embed: false,
    reducedMotion: bootReducedMotion,
    theme: bootTheme,
    toasts: [],
  },
  setView: (view) => set({ view }),
  setFrameFocus: (focus) => set({ frameFocus: { x: focus.x, y: focus.y } }),
  setGaiaLayer: (on) => set({ gaiaLayer: on }),
  setTool: (tool) => set((state) => ({ tool: { ...state.tool, tool } })),
  setFrame: (frame) => set((state) => ({ tool: { ...state.tool, frame } })),
  setBlink: (partial) =>
    set((state) => ({
      tool: {
        ...state.tool,
        blink: clampItemIndex(state.dataset.dataset, mergeBlink(state.tool.blink, partial)),
      },
    })),
  setSed: (partial) =>
    set((state) => ({
      tool: { ...state.tool, sed: { ...state.tool.sed, ...partial } },
    })),
  setRgb: (partial) =>
    set((state) => ({
      tool: { ...state.tool, rgb: applyRgb(state.tool.rgb, partial) },
    })),
  stepBlink: (delta) =>
    set((state) => {
      const dataset = state.dataset.dataset
      const blink = state.tool.blink
      const steps = Math.trunc(delta)
      if (!dataset || steps === 0) return state
      const count = selectionLength(dataset, blink)
      if (count <= 0) return state
      let itemIndex = blink.itemIndex + steps
      if (blink.loop) itemIndex = ((itemIndex % count) + count) % count
      else itemIndex = Math.min(count - 1, Math.max(0, itemIndex))
      if (itemIndex === blink.itemIndex) return state
      return { tool: { ...state.tool, blink: { ...blink, itemIndex } } }
    }),
  openFrameInBlink: (frameIndex) =>
    set((state) => {
      const dataset = state.dataset.dataset
      const frame = dataset?.frames.frames[frameIndex]
      if (!dataset || !frame) return state
      const k = state.tool.blink.k
      const selected = selectFrames(dataset.frames.frames, frame.detector, frame.lambda_um, k)
      let itemIndex = 0
      for (let index = 0; index < selected.length; index += 1) {
        if (selected[index]?.index === frame.index) {
          itemIndex = index
          break
        }
      }
      const blink = clampItemIndex(dataset, {
        ...state.tool.blink,
        mode: 'frames',
        detector: frame.detector,
        lambda0: frame.lambda_um,
        itemIndex,
      })
      return { tool: { ...state.tool, tool: 'blink', blink } }
    }),
  setEmbed: (embed) => set((state) => ({ ui: { ...state.ui, embed } })),
  setTheme: (theme) => {
    writeStoredTheme(theme)
    applyTheme(theme)
    set((state) => ({ ui: { ...state.ui, theme } }))
  },
  pushToast: (message) => {
    const id = ++toastId
    set((state) => ({ ui: { ...state.ui, toasts: [...state.ui.toasts, { id, message }] } }))
  },
  dismissToast: (id) =>
    set((state) => ({ ui: { ...state.ui, toasts: state.ui.toasts.filter((toast) => toast.id !== id) } })),
  loadDataset: async (slug, options) => {
    loadController?.abort()
    const controller = new AbortController()
    loadController = controller
    const generation = ++loadGeneration
    set((state) => {
      const blink = blinkForFrames([], state.ui.reducedMotion)
      return {
        dataset: { slug, status: 'loading', dataset: null, errorCode: null },
        frameFocus: null,
        gaiaLayer: false,
        tool: {
          ...state.tool,
          frame: initialFrame(),
          blink,
          sed: initialSedState(blink),
          rgb: rgbStateFor(null),
        },
      }
    })
    try {
      const loaded = await fetchDataset(slug, { signal: controller.signal })
      if (generation !== loadGeneration || controller.signal.aborted) return
      const dataset = Object.freeze(loaded)
      const recenter = options?.recenter !== false
      set((state) => {
        const blink = blinkForFrames(dataset.frames.frames, state.ui.reducedMotion)
        return {
          dataset: { slug, status: 'ready', dataset, errorCode: null },
          frameFocus: null,
          gaiaLayer: dataset.gaia?.query_status === 'ok',
          view: recenter
            ? {
                ...state.view,
                ra: dataset.meta.center.ra_deg,
                dec: dataset.meta.center.dec_deg,
              }
            : state.view,
          tool: {
            ...state.tool,
            blink,
            sed: sedStateFor(dataset, blink),
            rgb: rgbStateFor(dataset),
          },
        }
      })
    } catch (error) {
      if (generation !== loadGeneration || controller.signal.aborted) return
      const errorCode = error instanceof ContractError ? error.code : 'invalid'
      set({ dataset: { slug, status: 'error', dataset: null, errorCode } })
    }
  },
}))

watchReducedMotion((partial) => {
  useWorkspaceStore.setState(partial)
})
