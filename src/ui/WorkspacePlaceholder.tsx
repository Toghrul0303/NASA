import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { MapTargetOption } from '../map/AladinMap'
import type { Dataset } from '../data/dataset'
import { loadRegistry, type RegistryEntry } from '../data/registry'
import { useWorkspaceStore } from '../state/store'
import { applyTheme } from './theme'
import { AsteriskIcon, ChevronDownIcon, MoonIcon, SunIcon } from './icons'
import { Skeleton } from './Skeleton'
import { Lab } from '../lab/Lab'

const AladinMap = lazy(() => import('../map/AladinMap').then((mod) => ({ default: mod.AladinMap })))

const LAB_MIN = 30
const LAB_MAX = 60
const LAB_DEFAULT = 45

/** Aladin's top row: projection, fullscreen, and the coordinate box. */
const ALADIN_TOP_ROW = '.aladin-projection-control, .aladin-fullScreen-control, .aladin-location'

function syncMapChrome(map: HTMLElement): void {
  const mapRect = map.getBoundingClientRect()
  let bottom = 0
  for (const node of map.querySelectorAll<HTMLElement>(ALADIN_TOP_ROW)) {
    const rect = node.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    bottom = Math.max(bottom, rect.bottom - mapRect.top)
  }
  if (bottom > 0) map.style.setProperty('--aladin-chrome-bottom', `${bottom}px`)
  else map.style.removeProperty('--aladin-chrome-bottom')
}

function shortDataVersion(dataVersion: string): string {
  const marker = 'sha256:'
  const at = dataVersion.indexOf(marker)
  const hex = at === -1 ? dataVersion : dataVersion.slice(at + marker.length)
  return hex.slice(0, 8)
}

function tierLabel(tier: string): string {
  if (tier === 'tier1') return 'Tier 1'
  if (tier === 'tier1_5') return 'Tier 1.5'
  if (tier === 'tier2') return 'Tier 2'
  return tier
}

function clampLab(percent: number): number {
  return Math.min(LAB_MAX, Math.max(LAB_MIN, percent))
}

function mapTargets(entries: readonly RegistryEntry[]): MapTargetOption[] {
  const targets: MapTargetOption[] = []
  for (const entry of entries) {
    if (!entry.available || entry.center === null) continue
    targets.push({
      id: entry.slug,
      label: entry.title ?? entry.slug,
      ra: entry.center.ra_deg,
      dec: entry.center.dec_deg,
    })
  }
  return targets
}

/**
 * Host for `/workspace`. The home page does not render this.
 * F0 left this component as the route target; the shell lives here, not in App.
 */
export function WorkspacePage() {
  const view = useWorkspaceStore((state) => state.view)
  const setView = useWorkspaceStore((state) => state.setView)
  const tool = useWorkspaceStore((state) => state.tool.tool)
  const setTool = useWorkspaceStore((state) => state.setTool)
  const datasetState = useWorkspaceStore((state) => state.dataset)
  const loadDataset = useWorkspaceStore((state) => state.loadDataset)
  const embed = useWorkspaceStore((state) => state.ui.embed)
  const setEmbed = useWorkspaceStore((state) => state.setEmbed)
  const theme = useWorkspaceStore((state) => state.ui.theme)
  const setTheme = useWorkspaceStore((state) => state.setTheme)
  const [entries, setEntries] = useState<readonly RegistryEntry[]>([])
  const [labPct, setLabPct] = useState(LAB_DEFAULT)
  const mapRef = useRef<HTMLDivElement>(null)
  const devGaiaPatched = useRef<Dataset | null>(null)

  useLayoutEffect(() => {
    applyTheme(theme)
  }, [theme])

  useLayoutEffect(() => {
    const map = mapRef.current
    if (!map) return undefined
    let frame = 0
    const schedule = () => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        syncMapChrome(map)
      })
    }
    const resize = new ResizeObserver(schedule)
    resize.observe(map)
    const watchControls = () => {
      for (const node of map.querySelectorAll<HTMLElement>(ALADIN_TOP_ROW)) resize.observe(node)
    }
    watchControls()
    schedule()
    const mutations = new MutationObserver(() => {
      watchControls()
      schedule()
    })
    mutations.observe(map, { childList: true, subtree: true })
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
    }
  }, [])

  // TEMP until F10 urlSync
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('embed') === '1') setEmbed(true)
    const slug = params.get('slug')
    if (slug) {
      void loadDataset(slug)
      return
    }
    if (import.meta.env.DEV) void loadDataset('fixture-barnard')
  }, [loadDataset, setEmbed])

  // TEMP dev only
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    const dataset = datasetState.dataset
    if (datasetState.status !== 'ready' || dataset === null) return undefined
    const kind = new URLSearchParams(window.location.search).get('devGaia')
    let cancelled = false
    void import('../dev/gaiaSamples').then((mod) => {
      if (cancelled || !mod.isGaiaSampleKind(kind)) return
      if (devGaiaPatched.current === dataset) return
      const next: Dataset = { ...dataset, gaia: mod.makeGaiaSample(dataset.gaia, kind) }
      Object.freeze(next)
      devGaiaPatched.current = next
      useWorkspaceStore.setState((state) => {
        if (state.dataset.dataset !== dataset) return state
        return { dataset: { ...state.dataset, dataset: next } }
      })
    })
    return () => {
      cancelled = true
    }
  }, [datasetState.dataset, datasetState.status])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    void loadRegistry({ signal: controller.signal }).then((next) => {
      if (!cancelled) setEntries(next)
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  const dataset = datasetState.dataset
  const ready = datasetState.status === 'ready' && dataset !== null
  const labOpen = datasetState.status !== 'ready' || tool !== 'map'
  const options = useMemo(() => {
    const slug = datasetState.slug
    if (!slug || entries.some((entry) => entry.slug === slug)) return entries
    const extra: RegistryEntry = {
      slug,
      tier: 'tier1',
      available: true,
      title: dataset?.meta.title ?? slug,
      center: dataset?.meta.center ?? null,
      thumbUrl: null,
    }
    return [extra, ...entries]
  }, [dataset, datasetState.slug, entries])

  const shellStyle = { '--lab-pct': `${labPct}%` } as CSSProperties

  function toggleLab(): void {
    setTool(tool === 'map' ? 'blink' : 'map')
  }

  function onSeparatorKey(event: KeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? 5 : 1
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      setLabPct((current) => clampLab(current + step))
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      setLabPct((current) => clampLab(current - step))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setLabPct(LAB_MIN)
    } else if (event.key === 'End') {
      event.preventDefault()
      setLabPct(LAB_MAX)
    }
  }

  function onSeparatorDown(event: ReactPointerEvent<HTMLDivElement>): void {
    const separator = event.currentTarget
    const body = separator.parentElement
    if (!body) return
    separator.setPointerCapture(event.pointerId)
    const move = (ev: PointerEvent) => {
      const rect = body.getBoundingClientRect()
      if (rect.width <= 0) return
      const percent = ((rect.right - ev.clientX) / rect.width) * 100
      setLabPct(clampLab(percent))
    }
    const end = () => {
      separator.removeEventListener('pointermove', move)
      separator.removeEventListener('pointerup', end)
      separator.removeEventListener('pointercancel', end)
    }
    separator.addEventListener('pointermove', move)
    separator.addEventListener('pointerup', end)
    separator.addEventListener('pointercancel', end)
  }

  const tier1 = options.filter((entry) => entry.tier === 'tier1')
  const tier15 = options.filter((entry) => entry.tier === 'tier1_5')
  const headerTitle =
    datasetState.status === 'loading'
      ? 'Loading dataset…'
      : ready
        ? dataset.meta.title
        : datasetState.status === 'error'
          ? 'Dataset unavailable'
          : 'Pick a target'

  return (
    <div className="ws-shell" data-lab={labOpen ? 'open' : 'closed'} style={shellStyle}>
      {embed ? null : (
        <header className="h-12 flex-none bg-white/95 dark:bg-[#050505]/95 backdrop-blur-md border-b border-black/15 dark:border-white/10 px-4 flex items-center justify-between gap-3 text-zinc-950 dark:text-white">
          <div className="flex items-center gap-3 min-w-0">
            <a href="/" className="brand-mark shrink-0 !text-zinc-950 dark:!text-white" aria-label="ExoTrace home">
              <AsteriskIcon className="w-[18px] h-[18px]" />
              <span className="brand-mark__word">ExoTrace</span>
            </a>
            <span className="h-4 w-px bg-black/15 dark:bg-white/15 shrink-0" aria-hidden="true" />
            <h1
              className="m-0 text-sm font-medium text-zinc-900 dark:text-white/90 truncate max-w-[220px] xl:max-w-[380px]"
              title={headerTitle}
            >
              {datasetState.status === 'loading' ? <Skeleton className="h-4 w-40 rounded-full" /> : headerTitle}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {ready ? (
              <div className="hidden md:flex items-center gap-2 rounded-full bg-black/[0.04] dark:bg-white/[0.04] border border-black/15 dark:border-white/10 px-2.5 py-1 text-xs">
                <span className="text-zinc-700 dark:text-white/75 font-medium">{tierLabel(dataset.meta.tier)}</span>
                <span
                  className={
                    dataset.meta.status === 'partial'
                      ? 'rounded-full px-2 py-0.5 text-[11px] bg-amber-500/20 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300 border border-amber-600/40 dark:border-amber-400/35'
                      : 'rounded-full px-2 py-0.5 text-[11px] bg-emerald-500/15 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300 border border-emerald-600/30 dark:border-emerald-500/25'
                  }
                >
                  {dataset.meta.status}
                </span>
                <span
                  className="font-mono tabular-nums text-[11px] text-zinc-600 dark:text-white/60 bg-black/[0.05] dark:bg-white/[0.05] rounded-full px-2 py-0.5"
                  title={dataset.meta.data_version}
                >
                  <span className="ws-sr">Data version</span>
                  {shortDataVersion(dataset.meta.data_version)}
                </span>
              </div>
            ) : null}

            <label className="relative inline-flex items-center">
              <span className="ws-sr">Target</span>
              <select
                className="appearance-none rounded-full bg-white dark:bg-[#0D0D12] border border-black/20 dark:border-white/15 hover:border-[#E4F222]/60 focus:border-[#E4F222] text-zinc-900 dark:text-white text-xs pl-3.5 pr-8 py-1.5 max-w-[230px] truncate transition-colors cursor-pointer"
                value={datasetState.slug ?? ''}
                onChange={(event) => {
                  const slug = event.target.value
                  if (slug) void loadDataset(slug)
                }}
              >
                <option value="" className="bg-white text-zinc-900 dark:bg-[#0D0D12] dark:text-white">
                  Pick a target
                </option>
                {tier1.length > 0 ? (
                  <optgroup label="Tier 1" className="bg-white text-zinc-900 dark:bg-[#0D0D12] dark:text-white">
                    {tier1.map((entry) => (
                      <option
                        key={entry.slug}
                        value={entry.slug}
                        disabled={!entry.available}
                        className={
                          entry.available
                            ? 'bg-white text-zinc-900 dark:bg-[#0D0D12] dark:text-white'
                            : 'bg-white text-zinc-400 dark:bg-[#0D0D12] dark:text-white/35'
                        }
                      >
                        {entry.title ?? entry.slug}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {tier15.length > 0 ? (
                  <optgroup label="Tier 1.5" className="bg-white text-zinc-900 dark:bg-[#0D0D12] dark:text-white">
                    {tier15.map((entry) => (
                      <option
                        key={entry.slug}
                        value={entry.slug}
                        disabled={!entry.available}
                        className={
                          entry.available
                            ? 'bg-white text-zinc-900 dark:bg-[#0D0D12] dark:text-white'
                            : 'bg-white text-zinc-400 dark:bg-[#0D0D12] dark:text-white/35'
                        }
                      >
                        {entry.title ?? entry.slug}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-2.5 w-3.5 h-3.5 text-zinc-500 dark:text-white/60" />
            </label>

            <button
              type="button"
              className="rounded-full bg-black/[0.04] dark:bg-white/[0.04] border border-black/20 dark:border-white/[0.12] hover:border-black/40 dark:hover:border-white/30 text-zinc-800 dark:text-white/80 hover:text-black dark:hover:text-white text-xs px-3 py-1.5 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
              aria-pressed={theme === 'dark'}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <SunIcon className="w-3.5 h-3.5" /> : <MoonIcon className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>

            {ready ? (
              <button
                type="button"
                className="hidden lg:inline-flex items-center gap-1.5 rounded-full bg-zinc-900 dark:bg-[#0A0A0D] border border-[#E4F222]/70 text-[#E4F222] hover:bg-[#E4F222] hover:text-black font-medium text-xs px-3.5 py-1.5 transition-colors cursor-pointer"
                aria-expanded={tool !== 'map'}
                onClick={toggleLab}
              >
                {tool === 'map' ? 'Open Lab' : 'Close Lab'}
              </button>
            ) : null}
          </div>
        </header>
      )}
      <div className="ws-body">
        <div ref={mapRef} className="ws-map bg-black">
          <Suspense fallback={<div className="h-full w-full bg-black" aria-label="Loading sky map" />}>
            <AladinMap
              ra={view.ra}
              dec={view.dec}
              fov={view.fov}
              targets={mapTargets(options)}
              onViewChange={setView}
              onTargetSelect={(target) => {
                void loadDataset(target.id)
              }}
            />
          </Suspense>
          {embed && ready && tool === 'map' ? (
            <button
              type="button"
              className="ws-open-lab rounded-full bg-[#0A0A0D] border border-[#E4F222]/70 text-[#E4F222] hover:bg-[#E4F222] hover:text-black font-medium text-xs px-3.5 py-1.5 transition-colors"
              onClick={toggleLab}
            >
              Open Lab
            </button>
          ) : null}
        </div>
        {datasetState.status === 'ready' ? (
          <button type="button" className="ws-pill ws-lab-toggle" aria-expanded={tool !== 'map'} onClick={toggleLab}>
            {tool === 'map' ? 'Open Lab' : 'Close Lab'}
          </button>
        ) : null}
        {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        <div
          className="ws-separator group w-1.5 bg-transparent hover:bg-[#E4F222]/40 focus-visible:bg-[#E4F222]/60 transition-colors cursor-col-resize items-center justify-center"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize laboratory panel"
          aria-valuemin={LAB_MIN}
          aria-valuemax={LAB_MAX}
          aria-valuenow={Math.round(labPct)}
          aria-valuetext={`${Math.round(labPct)} percent`}
          tabIndex={0}
          onKeyDown={onSeparatorKey}
          onPointerDown={onSeparatorDown}
        >
          <span className="w-px h-8 bg-black/20 dark:bg-white/20 group-hover:bg-black/40 dark:group-hover:bg-white/40 transition-colors" aria-hidden="true" />
        </div>
        {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        <aside
          className="ws-lab bg-slate-50 dark:bg-[#07070A] border-t lg:border-t-0 lg:border-l border-black/15 dark:border-white/10 text-zinc-950 dark:text-white"
          aria-label="Laboratory"
        >
          <Lab />
        </aside>
      </div>
    </div>
  )
}

export const WorkspacePlaceholder = WorkspacePage
