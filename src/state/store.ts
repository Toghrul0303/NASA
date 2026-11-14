/**
 * Workspace store. FRONTEND_SPEC §4.2.
 * A dataset is replaced as a whole and is not mutated after `ready`.
 */
import { create } from 'zustand'
import { ZOOM_MIN } from '../config/constants'
import type { ToolId } from '../config/tools'
import { ContractError, type ContractErrorCode } from '../contract/validate'
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

export type DatasetLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface DatasetState {
  slug: string | null
  status: DatasetLoadStatus
  dataset: Dataset | null
  errorCode: ContractErrorCode | null
}

export interface ToolState {
  tool: ToolId
  frame: FrameViewport
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
  tool: ToolState
  dataset: DatasetState
  job: JobState
  ui: UiState
  setView: (view: ViewState) => void
  setTool: (tool: ToolId) => void
  setFrame: (frame: FrameViewport) => void
  setEmbed: (embed: boolean) => void
  setTheme: (theme: ThemeName) => void
  pushToast: (message: string) => void
  dismissToast: (id: number) => void
  loadDataset: (slug: string) => Promise<void>
}

const DEFAULT_FOV_DEG = 0.5

const initialFrame = (): FrameViewport => ({ zoom: ZOOM_MIN, panX: 0, panY: 0 })

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

export const useWorkspaceStore = create<WorkspaceStore>()((set) => ({
  view: { ra: 0, dec: 0, fov: DEFAULT_FOV_DEG },
  tool: { tool: 'map', frame: initialFrame() },
  dataset: { slug: null, status: 'idle', dataset: null, errorCode: null },
  job: { status: 'idle' },
  ui: {
    embed: false,
    reducedMotion: prefersReducedMotion(),
    theme: initialTheme(),
    toasts: [],
  },
  setView: (view) => set({ view }),
  setTool: (tool) => set((state) => ({ tool: { ...state.tool, tool } })),
  setFrame: (frame) => set((state) => ({ tool: { ...state.tool, frame } })),
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
  loadDataset: async (slug) => {
    loadController?.abort()
    const controller = new AbortController()
    loadController = controller
    const generation = ++loadGeneration
    set((state) => ({
      dataset: { slug, status: 'loading', dataset: null, errorCode: null },
      tool: { ...state.tool, frame: initialFrame() },
    }))
    try {
      const loaded = await fetchDataset(slug, { signal: controller.signal })
      if (generation !== loadGeneration || controller.signal.aborted) return
      const dataset = Object.freeze(loaded)
      set((state) => ({
        dataset: { slug, status: 'ready', dataset, errorCode: null },
        view: {
          ...state.view,
          ra: dataset.meta.center.ra_deg,
          dec: dataset.meta.center.dec_deg,
        },
      }))
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
