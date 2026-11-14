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
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { URL_DEBOUNCE_MS } from '../config/constants'
import { liveAnalysisUnavailable } from '../config/copy'
import type { AladinMapHandle, MapTargetOption } from '../map/AladinMap'
import { footprintPolygon } from '../map/footprint'
import type { Dataset } from '../data/dataset'
import { loadRegistry, type RegistryEntry } from '../data/registry'
import { useWorkspaceStore } from '../state/store'
import { createUrlSync, wrapRa, type UrlSync, type UrlSyncWindow } from '../state/urlSync'
import { applyTheme } from './theme'
import {
  AsteriskIcon,
  ChevronDownIcon,
  HomeIcon,
  InfoIcon,
  MoonIcon,
  OrbitIcon,
  SunIcon,
  TelescopeIcon,
} from './icons'
import { Skeleton } from './Skeleton'
import { Lab } from '../lab/Lab'

const AladinMap = lazy(() => import('../map/AladinMap').then((mod) => ({ default: mod.AladinMap })))

function browserWindow(): UrlSyncWindow {
  return {
    history: window.history,
    location: window.location,
    addEventListener: (type, listener) => window.addEventListener(type, listener),
    removeEventListener: (type, listener) => window.removeEventListener(type, listener),
  }
}

const LAB_MIN = 30
const LAB_MAX = 60
const LAB_DEFAULT = 45

/** Aladin's top row + HUD controls so horizontal HUD pills stay aligned with zero overlap. */
const ALADIN_TOP_ROW = '.aladin-projection-control, .aladin-fullScreen-control, .aladin-cooFrame, .aladin-location, .ws-open-lab-btn, .ws-map-layer'

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

  const cta = map.querySelector<HTMLElement>('.ws-open-lab-btn')
  const ctaRect = cta?.getBoundingClientRect()
  const rightOffset =
    ctaRect && ctaRect.width > 0 ? Math.max(12, Math.round(mapRect.right - ctaRect.left + 8)) : 12
  map.style.setProperty('--aladin-proj-right', `${rightOffset}px`)

  const loc = map.querySelector<HTMLElement>('.aladin-location')
  const locRect = loc?.getBoundingClientRect()
  const gaia = map.querySelector<HTMLElement>('.ws-map-layer')
  const gaiaWidth = gaia ? gaia.getBoundingClientRect().width : 0
  const proj = map.querySelector<HTMLElement>('.aladin-projection-control')
  const projWidth = proj ? proj.getBoundingClientRect().width : 0

  if (locRect && locRect.width > 0) {
    const inlineLeft = Math.max(12, Math.round(locRect.right - mapRect.left + 8))
    const rightSpaceStart = mapRect.width - rightOffset - (projWidth > 0 ? projWidth + 8 : 0)
    if (gaiaWidth > 0 && inlineLeft + gaiaWidth > rightSpaceStart) {
      map.style.setProperty('--aladin-gaia-left', '12px')
      map.style.setProperty('--aladin-gaia-top', '56px')
    } else {
      map.style.setProperty('--aladin-gaia-left', `${inlineLeft}px`)
      map.style.setProperty('--aladin-gaia-top', '12px')
    }
  } else {
    map.style.setProperty('--aladin-gaia-left', '12px')
    map.style.setProperty('--aladin-gaia-top', '12px')
  }
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
  const gaiaLayer = useWorkspaceStore((state) => state.gaiaLayer)
  const setGaiaLayer = useWorkspaceStore((state) => state.setGaiaLayer)
  const tool = useWorkspaceStore((state) => state.tool.tool)
  const setTool = useWorkspaceStore((state) => state.setTool)
  const datasetState = useWorkspaceStore((state) => state.dataset)
  const loadDataset = useWorkspaceStore((state) => state.loadDataset)
  const embed = useWorkspaceStore((state) => state.ui.embed)
  const toasts = useWorkspaceStore((state) => state.ui.toasts)
  const dismissToast = useWorkspaceStore((state) => state.dismissToast)
  const theme = useWorkspaceStore((state) => state.ui.theme)
  const setTheme = useWorkspaceStore((state) => state.setTheme)
  const [entries, setEntries] = useState<readonly RegistryEntry[]>([])
  const [labPct, setLabPct] = useState(LAB_DEFAULT)
  const [labDismissed, setLabDismissed] = useState(false)
  const mapRef = useRef<HTMLDivElement>(null)
  const mapApi = useRef<AladinMapHandle | null>(null)
  const syncRef = useRef<UrlSync | null>(null)
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

  useLayoutEffect(() => {
    const sync = createUrlSync({
      win: browserWindow(),
      setTimeout: (handler, timeout) => window.setTimeout(handler, timeout),
      clearTimeout: (id) => window.clearTimeout(id),
      debounceMs: URL_DEBOUNCE_MS,
      applyUrlState: (parsed) => {
        const store = useWorkspaceStore.getState()
        store.setView({
          ra: parsed.ra ?? store.view.ra,
          dec: parsed.dec ?? store.view.dec,
          fov: parsed.fov ?? store.view.fov,
        })
        store.setTool(parsed.tool)
        store.setEmbed(parsed.embed)
      },
      gotoRaDec: (ra, dec) => mapApi.current?.gotoRaDec(ra, dec),
      setFov: (fov) => mapApi.current?.setFov(fov),
      loadDataset: (slug, options) => useWorkspaceStore.getState().loadDataset(slug, options),
      getDatasetCenter: () => {
        const dataset = useWorkspaceStore.getState().dataset.dataset
        if (!dataset) return null
        return { ra: dataset.meta.center.ra_deg, dec: dataset.meta.center.dec_deg }
      },
      createJobForCoordinate: (ra, dec) => {
        // TEMP until F15
        const store = useWorkspaceStore.getState()
        if (!store.ui.toasts.some((toast) => toast.message === liveAnalysisUnavailable)) {
          store.pushToast(liveAnalysisUnavailable)
        }
        store.setTool('map')
        store.setView({ ra, dec, fov: store.view.fov })
      },
    })
    syncRef.current = sync
    const unsubscribe = useWorkspaceStore.subscribe((state, previous) => {
      if (state.tool.tool !== previous.tool.tool) sync.onToolChanged(state.tool.tool)
    })
    void sync.boot()
    return () => {
      unsubscribe()
      sync.dispose()
      if (syncRef.current === sync) syncRef.current = null
    }
  }, [])

  // TEMP dev only. `devGaia` is an unknown query parameter kept by urlSync.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    const dataset = datasetState.dataset
    if (datasetState.status !== 'ready' || dataset === null) return undefined
    const kind = syncRef.current?.unknownParams().find(([key]) => key === 'devGaia')?.[1] ?? null
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
  const footprint = useMemo(() => (ready && dataset ? footprintPolygon(dataset.meta.grid) : null), [ready, dataset])
  const gaia = ready && dataset ? dataset.gaia : null
  const labOpen = ready ? tool !== 'map' : !labDismissed
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
    if (!ready) {
      setLabDismissed((current) => !current)
      return
    }
    setTool(tool === 'map' ? 'blink' : 'map')
  }

  function chooseSlug(slug: string): void {
    if (!slug) return
    setLabDismissed(false)
    syncRef.current?.onSlugChanged(slug)
    void loadDataset(slug).then(() => {
      const state = useWorkspaceStore.getState()
      if (state.dataset.status !== 'ready' || state.dataset.slug !== slug) return
      syncRef.current?.onMapViewChanged(state.view.ra, state.view.dec, state.view.fov)
    })
  }

  function onEmbedClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if (!embed) return
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest('a')
    if (!(anchor instanceof HTMLAnchorElement)) return
    const linkOut = anchor.target === '_blank' && anchor.rel.split(/\s+/).includes('noopener')
    if (linkOut) return
    event.preventDefault()
    event.stopPropagation()
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
    <div
      className="ws-shell"
      data-lab={labOpen ? 'open' : 'closed'}
      data-embed={embed ? 'true' : 'false'}
      style={shellStyle}
      onClickCapture={onEmbedClick}
    >
      {embed ? null : (
        <header className="h-14 flex-none bg-[#05060A]/85 backdrop-blur-xl border-b border-white/[0.10] text-white px-4 flex lg:grid lg:grid-cols-[1fr_auto_1fr] items-center justify-between gap-3 z-30">
          <div className="justify-self-start flex items-center gap-3 min-w-0">
            <a href="/" className="brand-mark shrink-0 !text-white" aria-label="ExoTrace home">
              <AsteriskIcon />
              <span className="brand-mark__word">ExoTrace</span>
            </a>
            <span className="h-4 w-px bg-white/15 shrink-0" aria-hidden="true" />
            <h1
              className="m-0 px-3 py-1 rounded-full bg-white/[0.05] border border-white/[0.12] text-xs sm:text-sm font-medium text-white/90 truncate max-w-[160px] lg:max-w-[200px] xl:max-w-[240px]"
              title={headerTitle}
            >
              {datasetState.status === 'loading' ? <Skeleton className="h-4 w-28 rounded-full bg-white/10" /> : headerTitle}
            </h1>
          </div>

          <nav
            aria-label="Main navigation"
            className="justify-self-center hidden md:flex items-center gap-1 rounded-full bg-white/[0.05] backdrop-blur-xl border border-white/[0.14] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),0_8px_28px_rgba(0,0,0,0.45)] px-1.5 py-1"
          >
            <a
              href="/"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] leading-none text-white/65 hover:text-white transition-colors whitespace-nowrap"
            >
              <HomeIcon className="w-4 h-4 shrink-0" />
              <span>Home</span>
            </a>
            <a
              href="/#targets"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] leading-none text-white/65 hover:text-white transition-colors whitespace-nowrap"
            >
              <TelescopeIcon className="w-4 h-4 shrink-0" />
              <span>Targets</span>
            </a>
            <a
              href="/#about"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] leading-none text-white/65 hover:text-white transition-colors whitespace-nowrap"
            >
              <InfoIcon className="w-4 h-4 shrink-0" />
              <span>About</span>
            </a>
            <a
              href="/workspace"
              aria-current="page"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] leading-none font-medium bg-[rgba(240,255,60,0.14)] border border-[rgba(240,255,60,0.72)] text-[rgb(240,255,60)] shadow-[inset_0_1px_0_0_rgba(240,255,60,0.28)] whitespace-nowrap"
            >
              <OrbitIcon className="w-4 h-4 shrink-0" />
              <span>Workspace</span>
            </a>
          </nav>

          <div className="justify-self-end flex items-center gap-1.5 shrink-0">
            {ready ? (
              <div className="hidden lg:flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-white/80 px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/[0.12] whitespace-nowrap">
                  {tierLabel(dataset.meta.tier)}
                </span>
                <span
                  className={
                    dataset.meta.status === 'partial'
                      ? 'rounded-full px-2.5 py-1 text-[11px] bg-amber-500/15 text-amber-300 border border-amber-400/40 whitespace-nowrap'
                      : 'rounded-full px-2.5 py-1 text-[11px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 inline-flex items-center gap-1.5 whitespace-nowrap'
                  }
                >
                  {dataset.meta.status === 'complete' ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                  ) : null}
                  {dataset.meta.status}
                </span>
                <span
                  className="hidden xl:inline-flex font-mono tabular-nums text-[11px] text-white/70 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.12] whitespace-nowrap"
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
                className="liquid-glass-btn appearance-none rounded-full text-xs pl-3 pr-7 h-8 max-w-[140px] sm:max-w-[165px] xl:max-w-[200px] truncate !text-white/90 focus:border-[rgb(240,255,60)]"
                value={datasetState.slug ?? ''}
                onChange={(event) => {
                  chooseSlug(event.target.value)
                }}
              >
                <option value="" className="bg-[#0B0C10] text-white">
                  Pick a target
                </option>
                {tier1.length > 0 ? (
                  <optgroup label="Tier 1" className="bg-[#0B0C10] text-white">
                    {tier1.map((entry) => (
                      <option
                        key={entry.slug}
                        value={entry.slug}
                        disabled={!entry.available}
                        className={entry.available ? 'bg-[#0B0C10] text-white' : 'bg-[#0B0C10] text-white/35'}
                      >
                        {entry.title ?? entry.slug}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {tier15.length > 0 ? (
                  <optgroup label="Tier 1.5" className="bg-[#0B0C10] text-white">
                    {tier15.map((entry) => (
                      <option
                        key={entry.slug}
                        value={entry.slug}
                        disabled={!entry.available}
                        className={entry.available ? 'bg-[#0B0C10] text-white' : 'bg-[#0B0C10] text-white/35'}
                      >
                        {entry.title ?? entry.slug}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-2.5 w-3.5 h-3.5 text-white/60" />
            </label>

            <button
              type="button"
              className="liquid-glass-btn h-8 px-2.5 text-xs gap-1.5 !text-white/85"
              aria-pressed={theme === 'dark'}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <SunIcon className="w-3.5 h-3.5" /> : <MoonIcon className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>
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
              footprint={footprint}
              gaia={gaia}
              gaiaLayerEnabled={gaia?.query_status === 'ok'}
              gaiaLayerOn={gaiaLayer}
              onGaiaLayerChange={setGaiaLayer}
              embed={embed}
              mapRef={(handle) => {
                mapApi.current = handle
              }}
              onViewChange={(next) => {
                const ra = wrapRa(next.ra)
                syncRef.current?.onMapViewChanged(ra, next.dec, next.fov)
                setView({ ra, dec: next.dec, fov: next.fov })
              }}
              onTargetSelect={(target) => {
                chooseSlug(target.id)
              }}
            />
          </Suspense>
          <button
            type="button"
            className="ws-open-lab-btn hidden lg:inline-flex liquid-glass-cta absolute top-3 right-3 z-30 h-9 px-4 rounded-full text-xs font-medium items-center gap-1.5 whitespace-nowrap"
            aria-expanded={labOpen}
            onClick={toggleLab}
          >
            {labOpen ? 'Close Lab' : 'Open Lab'}
          </button>
        </div>
        <button
          type="button"
          className="ws-lab-toggle liquid-glass-cta !rounded-none text-xs font-medium"
          aria-expanded={labOpen}
          onClick={toggleLab}
        >
          {labOpen ? 'Close Lab' : 'Open Lab'}
        </button>
        {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        <div
          className="ws-separator group w-1.5 bg-transparent hover:bg-[rgba(240,255,60,0.4)] focus-visible:bg-[rgba(240,255,60,0.6)] transition-colors cursor-col-resize items-center justify-center"
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
      {toasts.length > 0 ? (
        <div className="ws-toasts">
          {toasts.map((toast) => (
            <button
              key={toast.id}
              type="button"
              className="ws-toast liquid-glass-bar text-left text-zinc-950 dark:text-white"
              onClick={() => dismissToast(toast.id)}
            >
              {toast.message}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export const WorkspacePlaceholder = WorkspacePage
