/**
 * Workspace store. FRONTEND_SPEC §4.2.
 * A dataset is replaced as a whole and is not mutated after `ready`.
 */
import { create } from 'zustand'
import {
  createTier2Client,
  type MockJobState,
  type SubmitOptions,
  type SubmitResult,
  type Tier2Listener,
} from '../api/tier2Client'
import { ZOOM_MIN } from '../config/constants'
import { env } from '../config/env'
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
import { defaultSpectralPair, defaultTemporalPair, type DiffMode, type DiffOperand } from '../core/difference'
import { clampRgbGain, type RgbGains, type RgbMemberPreset } from '../core/rgb'
import {
  getProfile,
  getSession,
  signInWithUsername,
  signOut,
  signUp,
  type AuthError,
  type SignInWithUsernameInput,
  type SignUpInput,
  type SupabaseProfileRow,
  type SupabaseSession,
  type SupabaseUser,
} from '../data/authClient'
import type { Dataset } from '../data/dataset'
import { loadDataset as fetchDataset } from '../data/loader'
import {
  INVALID_SIZE_BODY,
  isInvalidSizeBody,
  type CompleteEvent,
  type FailedEvent,
  type JobObject,
  type JobRequest,
} from '../core/tier2'
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

/** Difference imaging operands. Reset when the dataset changes. §11. */
export interface DiffState {
  mode: DiffMode
  a: DiffOperand | null
  b: DiffOperand | null
}

export type DiffPatch = Partial<DiffState>

export interface ToolState {
  tool: ToolId
  frame: FrameViewport
  blink: BlinkState
  sed: SedState
  rgb: RgbState
  diff: DiffState
}

/** UI states for a Tier 2 run. `partial` is a flag, not a status. */
export type JobUiStatus = 'idle' | 'submitting' | 'queued' | 'running' | 'complete' | 'failed'

export interface JobFieldError {
  field: string
  issue: string
}

export interface JobFailureView {
  code: string
  message: string
  retryable: boolean
}

export interface JobNavigation {
  token: number
  slug: string
}

export interface JobState {
  status: JobUiStatus
  partial: boolean
  cached: boolean
  joined: boolean
  queuePosition: number | null
  nFailedFetches: number
  jobId: string | null
  slug: string | null
  request: JobRequest | null
  failure: JobFailureView | null
  fieldErrors: readonly JobFieldError[]
  errorCode: string | null
  errorMessage: string | null
  navigation: JobNavigation | null
}

export type Tier2Body = JobRequest | typeof INVALID_SIZE_BODY

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

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated'

interface WorkspaceStore {
  session: SupabaseSession | null
  user: SupabaseUser | null
  profile: SupabaseProfileRow | null
  authStatus: AuthStatus
  /** Restore the stored session on app boot. */
  initAuth: () => Promise<void>
  /** Resolve to the error to show, or null on success. */
  signUpUser: (input: SignUpInput) => Promise<AuthError | null>
  loginUser: (input: SignInWithUsernameInput) => Promise<AuthError | null>
  logoutUser: () => Promise<void>
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
  setDiff: (partial: DiffPatch) => void
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
  /** POST one job. A cached complete loads the dataset without a queued or running state. */
  submitTier2: (body: Tier2Body, mockState?: MockJobState) => Promise<void>
  /** Re-POST the last request with `force_refresh: false`. */
  retryTier2: () => Promise<void>
  /** Drop an in-flight watch. The server job, if any, is left running. */
  cancelTier2: () => void
  /** Clear a failed or invalid notice so a new position starts clean. */
  resetTier2Notice: () => void
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

/** Temporal defaults from the Blink window; an empty dataset leaves both operands unset. */
export function diffStateFor(dataset: Dataset | null, blink: BlinkState): DiffState {
  if (!dataset) return { mode: 'temporal', a: null, b: null }
  return { mode: 'temporal', ...diffPairForMode(dataset, 'temporal', blink) }
}

/** Default pair for a mode, used when the mode changes. */
export function diffPairForMode(dataset: Dataset, mode: DiffMode, blink: BlinkState): Pick<DiffState, 'a' | 'b'> {
  const ctx = { frames: dataset.frames.frames, coadds: dataset.coadds.coadds }
  const pair =
    mode === 'temporal' ? defaultTemporalPair(ctx, blink.detector, blink.lambda0, blink.k) : defaultSpectralPair(ctx)
  return { a: pair?.a ?? null, b: pair?.b ?? null }
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
/** A toast closes itself after this long. */
const TOAST_MS = 2200
let toastId = 0

function watchReducedMotion(set: (partial: (state: WorkspaceStore) => Partial<WorkspaceStore>) => void): void {
  if (typeof matchMedia !== 'function') return
  const query = matchMedia('(prefers-reduced-motion: reduce)')
  const apply = () => {
    set((state) => ({ ui: { ...state.ui, reducedMotion: query.matches } }))
  }
  if (typeof query.addEventListener === 'function') query.addEventListener('change', apply)
}

function idleJob(navigation: JobNavigation | null): JobState {
  return {
    status: 'idle',
    partial: false,
    cached: false,
    joined: false,
    queuePosition: null,
    nFailedFetches: 0,
    jobId: null,
    slug: null,
    request: null,
    failure: null,
    fieldErrors: [],
    errorCode: null,
    errorMessage: null,
    navigation,
  }
}

function failureFromEvent(event: FailedEvent): JobFailureView {
  return { code: event.code, message: event.message, retryable: event.retryable }
}

const tier2Client = createTier2Client({
  useMocks: env.useMocks,
  apiBase: env.apiBase,
  mockDelayMs: env.mockJobDelayMs,
})

let jobAbort: AbortController | null = null
let jobToken = 0
let navToken = 0

function runningJob(current: JobState, job: JobObject): JobState {
  return {
    ...current,
    status: 'running',
    joined: job.joined,
    queuePosition: null,
    jobId: job.job_id,
    slug: job.slug,
    cached: false,
    partial: false,
    failure: null,
    fieldErrors: [],
    errorCode: null,
    errorMessage: null,
  }
}

function openFinishedSlug(slug: string): void {
  void useWorkspaceStore.getState().loadDataset(slug)
}

function finishComplete(event: CompleteEvent): void {
  const token = ++navToken
  useWorkspaceStore.setState((state) => ({
    job: {
      ...state.job,
      status: 'complete',
      partial: event.result_status === 'partial',
      cached: false,
      joined: state.job.joined,
      nFailedFetches: event.n_failed_fetches,
      jobId: event.job_id,
      slug: event.slug,
      failure: null,
      fieldErrors: [],
      errorCode: null,
      errorMessage: null,
      queuePosition: null,
      navigation: { token, slug: event.slug },
    },
  }))
  openFinishedSlug(event.slug)
}

function applyTier2Result(result: SubmitResult): void {
  if (result.kind === 'invalid') {
    useWorkspaceStore.setState((state) => ({
      job: {
        ...state.job,
        status: 'idle',
        failure: null,
        fieldErrors: result.error.error.details,
        errorCode: result.error.error.code,
        errorMessage: result.error.error.message,
      },
    }))
    return
  }
  if (result.kind === 'error') {
    useWorkspaceStore.setState((state) => ({
      job: {
        ...state.job,
        status: 'failed',
        failure: {
          code: result.error.error.code,
          message: result.error.error.message,
          retryable: false,
        },
        errorCode: result.error.error.code,
        errorMessage: result.error.error.message,
        fieldErrors: result.error.error.details,
      },
    }))
    return
  }
  const job = result.job
  if (job.status === 'failed') {
    const failure = result.failure
      ? failureFromEvent(result.failure)
      : { code: 'failed', message: '', retryable: false }
    useWorkspaceStore.setState((state) => ({
      job: {
        ...state.job,
        status: 'failed',
        cached: false,
        joined: job.joined,
        jobId: job.job_id,
        slug: null,
        partial: false,
        failure,
        errorCode: failure.code,
        errorMessage: failure.message,
        fieldErrors: [],
      },
    }))
    return
  }
  if (job.status === 'complete') {
    const token = ++navToken
    useWorkspaceStore.setState((state) => ({
      job: {
        ...state.job,
        status: 'complete',
        cached: job.cached,
        joined: job.joined,
        partial: false,
        nFailedFetches: 0,
        queuePosition: null,
        jobId: job.job_id,
        slug: job.slug,
        failure: null,
        fieldErrors: [],
        errorCode: null,
        errorMessage: null,
        navigation: { token, slug: job.slug },
      },
    }))
    openFinishedSlug(job.slug)
    return
  }
  useWorkspaceStore.setState((state) => ({
    job: {
      ...state.job,
      status: job.status,
      cached: false,
      joined: job.joined,
      queuePosition: job.status === 'queued' ? result.queuePosition : null,
      jobId: job.job_id,
      slug: job.slug,
      partial: false,
      failure: null,
      fieldErrors: [],
      errorCode: null,
      errorMessage: null,
    },
  }))
}

const bootTheme = initialTheme()
applyTheme(bootTheme)
const bootReducedMotion = prefersReducedMotion()
const bootBlink = blinkForFrames([], bootReducedMotion)
const bootRgb = rgbStateFor(null)

let authGeneration = 0

const SIGNED_OUT = { session: null, user: null, profile: null, authStatus: 'unauthenticated' } as const

async function signedInState(user: SupabaseUser, session: SupabaseSession) {
  const { data } = await getProfile(user.id)
  return { session, user, profile: data.profile, authStatus: 'authenticated' } as const
}

export const useWorkspaceStore = create<WorkspaceStore>()((set, get) => ({
  session: null,
  user: null,
  profile: null,
  authStatus: 'idle',
  initAuth: async () => {
    const generation = ++authGeneration
    set({ authStatus: 'loading' })
    try {
      const { data } = await getSession()
      const session = data.session
      const next = session ? await signedInState(session.user, session) : SIGNED_OUT
      if (generation === authGeneration) set(next)
    } catch {
      if (generation === authGeneration) set(SIGNED_OUT)
    }
  },
  signUpUser: async (input) => {
    const generation = ++authGeneration
    const { data, error } = await signUp(input)
    if (error) return error
    const next = await signedInState(data.user, data.session)
    if (generation === authGeneration) set(next)
    return null
  },
  loginUser: async (input) => {
    const generation = ++authGeneration
    const { data, error } = await signInWithUsername(input)
    if (error) return error
    const next = await signedInState(data.user, data.session)
    if (generation === authGeneration) set(next)
    return null
  },
  logoutUser: async () => {
    authGeneration += 1
    await signOut()
    set(SIGNED_OUT)
  },
  view: { ra: 0, dec: 0, fov: DEFAULT_FOV_DEG },
  frameFocus: null,
  gaiaLayer: false,
  tool: {
    tool: 'map',
    frame: initialFrame(),
    blink: bootBlink,
    sed: initialSedState(bootBlink),
    rgb: bootRgb,
    diff: diffStateFor(null, bootBlink),
  },
  dataset: { slug: null, status: 'idle', dataset: null, errorCode: null },
  job: idleJob(null),
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
  setDiff: (partial) =>
    set((state) => ({
      tool: { ...state.tool, diff: { ...state.tool.diff, ...partial } },
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
    setTimeout(() => get().dismissToast(id), TOAST_MS)
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
          diff: diffStateFor(null, blink),
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
            diff: diffStateFor(dataset, blink),
          },
        }
      })
    } catch (error) {
      if (generation !== loadGeneration || controller.signal.aborted) return
      const errorCode = error instanceof ContractError ? error.code : 'invalid'
      set({ dataset: { slug, status: 'error', dataset: null, errorCode } })
    }
  },
  submitTier2: async (body, mockState) => {
    jobAbort?.abort()
    const controller = new AbortController()
    jobAbort = controller
    const token = ++jobToken
    const request = isInvalidSizeBody(body) ? null : body
    set((state) => ({
      job: {
        ...idleJob(state.job.navigation),
        status: 'submitting',
        request,
      },
    }))
    let advanced = false
    const listener: Tier2Listener = {
      onRunning: (job) => {
        if (token !== jobToken || controller.signal.aborted) return
        advanced = true
        set((state) => ({ job: runningJob(state.job, job) }))
      },
      onComplete: (event) => {
        if (token !== jobToken || controller.signal.aborted) return
        advanced = true
        finishComplete(event)
      },
      onFailed: (event) => {
        if (token !== jobToken || controller.signal.aborted) return
        advanced = true
        set((state) => ({
          job: {
            ...state.job,
            status: 'failed',
            partial: false,
            failure: failureFromEvent(event),
            fieldErrors: [],
            errorCode: event.code,
            errorMessage: event.message,
          },
        }))
      },
    }
    const options: SubmitOptions = { signal: controller.signal, listener }
    if (mockState) options.mockState = mockState
    let result
    try {
      result = await tier2Client.submit(body, options)
    } catch {
      if (token !== jobToken || controller.signal.aborted) return
      set((state) => ({
        job: {
          ...state.job,
          status: 'failed',
          failure: { code: 'internal_error', message: '', retryable: false },
          errorCode: 'internal_error',
          errorMessage: '',
        },
      }))
      return
    }
    if (token !== jobToken || controller.signal.aborted) return
    if (result.kind === 'job' && advanced && (result.job.status === 'queued' || result.job.status === 'running')) return
    applyTier2Result(result)
  },
  retryTier2: async () => {
    const request = useWorkspaceStore.getState().job.request
    if (!request) return
    await useWorkspaceStore.getState().submitTier2({ ...request, force_refresh: false })
  },
  cancelTier2: () => {
    const status = useWorkspaceStore.getState().job.status
    if (status !== 'submitting' && status !== 'queued' && status !== 'running') return
    jobAbort?.abort()
    jobToken += 1
    set((state) => ({
      job: {
        ...idleJob(state.job.navigation),
        partial: state.job.partial,
        nFailedFetches: state.job.nFailedFetches,
      },
    }))
  },
  resetTier2Notice: () => {
    const status = useWorkspaceStore.getState().job.status
    if (status === 'submitting' || status === 'queued' || status === 'running') {
      useWorkspaceStore.getState().cancelTier2()
    }
    set((state) => ({
      job: {
        ...state.job,
        status: state.job.status === 'failed' || state.job.status === 'complete' ? 'idle' : state.job.status,
        failure: null,
        fieldErrors: [],
        errorCode: null,
        errorMessage: null,
        queuePosition: null,
      },
    }))
  },
}))

watchReducedMotion((partial) => {
  useWorkspaceStore.setState(partial)
})
