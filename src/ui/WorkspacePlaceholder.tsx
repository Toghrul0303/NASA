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
import { loadRegistry, type RegistryEntry } from '../data/registry'
import { useWorkspaceStore } from '../state/store'
import { applyTheme } from './theme'
import { AsteriskIcon } from './icons'
import { Chip } from './Chip'
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

  return (
    <div className="ws-shell" data-lab={labOpen ? 'open' : 'closed'} style={shellStyle}>
      {embed ? null : (
        <header className="ws-header">
          <a href="/" className="brand-mark" aria-label="ExoTrace home">
            <AsteriskIcon />
            <span className="brand-mark__word">ExoTrace</span>
          </a>
          <h1 className="ws-title">
            {datasetState.status === 'loading' ? (
              <Skeleton className="ws-skeleton--title" />
            ) : ready ? (
              dataset.meta.title
            ) : datasetState.status === 'error' ? (
              'Dataset unavailable'
            ) : (
              'Pick a target'
            )}
          </h1>
          {ready ? <Chip tone="neutral">{tierLabel(dataset.meta.tier)}</Chip> : null}
          {ready ? (
            <Chip tone={dataset.meta.status === 'partial' ? 'partial' : 'neutral'}>{dataset.meta.status}</Chip>
          ) : null}
          {ready ? (
            <span className="ws-num" title={dataset.meta.data_version}>
              <span className="ws-sr">Data version</span>
              {shortDataVersion(dataset.meta.data_version)}
            </span>
          ) : null}
          <label>
            <span className="ws-sr">Target</span>
            <select
              className="ws-select"
              value={datasetState.slug ?? ''}
              onChange={(event) => {
                const slug = event.target.value
                if (slug) void loadDataset(slug)
              }}
            >
              <option value="">Pick a target</option>
              {tier1.length > 0 ? (
                <optgroup label="Tier 1">
                  {tier1.map((entry) => (
                    <option key={entry.slug} value={entry.slug} disabled={!entry.available}>
                      {entry.title ?? entry.slug}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {tier15.length > 0 ? (
                <optgroup label="Tier 1.5">
                  {tier15.map((entry) => (
                    <option key={entry.slug} value={entry.slug} disabled={!entry.available}>
                      {entry.title ?? entry.slug}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          <button
            type="button"
            className="ws-pill"
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
        </header>
      )}
      <div className="ws-body">
        <div ref={mapRef} className="ws-map">
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
          {ready && tool === 'map' ? (
            <button type="button" className="ws-pill ws-pill--primary ws-open-lab" onClick={toggleLab}>
              Open lab
            </button>
          ) : null}
        </div>
        {datasetState.status === 'ready' ? (
          <button type="button" className="ws-pill ws-lab-toggle" aria-expanded={tool !== 'map'} onClick={toggleLab}>
            {tool === 'map' ? 'Show lab' : 'Hide lab'}
          </button>
        ) : null}
        {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        <div
          className="ws-separator"
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
        />
        {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        <aside className="ws-lab" aria-label="Laboratory">
          <Lab />
        </aside>
      </div>
    </div>
  )
}

export const WorkspacePlaceholder = WorkspacePage
