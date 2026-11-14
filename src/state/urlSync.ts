/**
 * URL <-> workspace state. FRONTEND_SPEC §5.
 * No React. `window`, `history`, and `location` are injected.
 */
import { FOV_MAX_DEG, FOV_MIN_DEG } from '../config/constants'
import { isToolId, type ToolId } from '../config/tools'
import { isValidSlug } from '../contract/validate'

const DEFAULT_RA = 0
const DEFAULT_DEC = 0
const DEFAULT_FOV = 0.5
const RA_DIGITS = 6
const DEC_DIGITS = 6
const FOV_DIGITS = 4
const SUPPRESS_MS = 600
const VIEW_EPSILON_DEG = 1e-6
export const WORKSPACE_PATH = '/workspace'

const KNOWN_PARAMS: ReadonlySet<string> = new Set(['ra', 'dec', 'fov', 'tool', 'slug', 'embed'])

export interface ParsedUrl {
  ra?: number
  dec?: number
  fov?: number
  tool: ToolId
  slug?: string
  embed: boolean
  unknown: Array<[string, string]>
}

export interface UrlWriteState {
  ra: number
  dec: number
  fov: number
  tool: ToolId
  slug?: string
  embed: boolean
}

export interface UrlLocation {
  pathname: string
  search: string
  hash: string
}

export interface UrlHistory {
  pushState(data: unknown, unused: string, url?: string | URL | null): void
  replaceState(data: unknown, unused: string, url?: string | URL | null): void
}

export interface UrlSyncWindow {
  history: UrlHistory
  location: UrlLocation
  addEventListener(type: string, listener: (event: Event) => void): void
  removeEventListener(type: string, listener: (event: Event) => void): void
}

export interface DatasetCenter {
  ra: number
  dec: number
}

export interface UrlSyncDeps {
  win: UrlSyncWindow
  setTimeout: (handler: () => void, timeout: number) => ReturnType<typeof setTimeout>
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void
  debounceMs: number
  applyUrlState: (parsed: ParsedUrl) => void
  gotoRaDec: (ra: number, dec: number) => void
  setFov: (fov: number) => void
  loadDataset: (slug: string, options: { recenter: boolean }) => Promise<void>
  getDatasetCenter: () => DatasetCenter | null
  /** TEMP until F15 replaces this with a real Tier 2 job. */
  createJobForCoordinate: (ra: number, dec: number) => void
}

export interface UrlSync {
  boot(): Promise<void>
  onMapViewChanged(ra: number, dec: number, fov: number): void
  onToolChanged(tool: ToolId): void
  onSlugChanged(slug: string | null): void
  dispose(): void
  unknownParams(): readonly (readonly [string, string])[]
}

interface MapView {
  ra: number
  dec: number
  fov: number
}

function readNumber(raw: string): number | undefined {
  const text = raw.trim()
  if (text.length === 0) return undefined
  const value = Number(text)
  if (!Number.isFinite(value)) return undefined
  return value
}

/** Wrap into `[0, 360)`. `360` itself becomes `0`. */
export function wrapRa(value: number): number {
  const wrapped = ((value % 360) + 360) % 360
  if (wrapped === 360) return 0
  return wrapped
}

function clampDec(value: number): number {
  if (value < -90) return -90
  if (value > 90) return 90
  return value
}

function clampFov(value: number): number {
  if (value < FOV_MIN_DEG) return FOV_MIN_DEG
  if (value > FOV_MAX_DEG) return FOV_MAX_DEG
  return value
}

/**
 * Fixed decimals, trailing zeros removed.
 * Rounding that collapses to zero is `0`, never `-0` or exponent notation.
 */
function formatDecimal(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '0'
  const text = value.toFixed(digits)
  if (text.includes('e') || text.includes('E')) return '0'
  if (/^-0(?:\.0+)?$/.test(text)) return '0'
  let out = text
  const dot = out.indexOf('.')
  if (dot !== -1) {
    let end = out.length
    while (end > dot + 1 && out[end - 1] === '0') end -= 1
    if (out[end - 1] === '.') end -= 1
    out = out.slice(0, end)
  }
  if (out === '-0' || out === '') return '0'
  return out
}

/** Round to 6 decimals first, then wrap, so `359.9999996` becomes `0`. */
function formatRa(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const roundedText = value.toFixed(RA_DIGITS)
  const rounded = Number(roundedText)
  if (!Number.isFinite(rounded)) return '0'
  return formatDecimal(wrapRa(rounded), RA_DIGITS)
}

export function parseUrl(search: string): ParsedUrl {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const parsed: ParsedUrl = { tool: 'map', embed: false, unknown: [] }
  const seen: Set<string> = new Set()
  for (const [key, value] of params) {
    if (!KNOWN_PARAMS.has(key)) {
      parsed.unknown.push([key, value])
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    if (key === 'ra') {
      const ra = readNumber(value)
      if (ra !== undefined) parsed.ra = wrapRa(ra)
    } else if (key === 'dec') {
      const dec = readNumber(value)
      if (dec !== undefined) parsed.dec = clampDec(dec)
    } else if (key === 'fov') {
      const fov = readNumber(value)
      if (fov !== undefined) parsed.fov = clampFov(fov)
    } else if (key === 'tool') {
      parsed.tool = isToolId(value) ? value : 'map'
    } else if (key === 'slug') {
      if (isValidSlug(value)) parsed.slug = value
    } else if (key === 'embed') {
      parsed.embed = value === '1'
    }
  }
  return parsed
}

export function serializeUrl(state: UrlWriteState, unknown: readonly (readonly [string, string])[]): string {
  const params = new URLSearchParams()
  params.set('ra', formatRa(state.ra))
  params.set('dec', formatDecimal(state.dec, DEC_DIGITS))
  params.set('fov', formatDecimal(state.fov, FOV_DIGITS))
  if (state.tool !== 'map') params.set('tool', state.tool)
  if (state.slug) params.set('slug', state.slug)
  if (state.embed) params.set('embed', '1')
  for (const pair of unknown) {
    params.append(pair[0], pair[1])
  }
  const query = params.toString()
  return query.length > 0 ? `?${query}` : ''
}

/** Query string plus the caller's pathname and hash, both unchanged. */
export function buildWorkspaceUrl(
  location: { pathname: string; hash: string },
  state: UrlWriteState,
  unknown: readonly (readonly [string, string])[],
): string {
  return `${location.pathname}${serializeUrl(state, unknown)}${location.hash}`
}

function viewsMatch(a: MapView, b: MapView): boolean {
  return (
    Math.abs(a.ra - b.ra) < VIEW_EPSILON_DEG &&
    Math.abs(a.dec - b.dec) < VIEW_EPSILON_DEG &&
    Math.abs(a.fov - b.fov) < VIEW_EPSILON_DEG
  )
}

function devLog(action: 'pushState' | 'replaceState', count: number): void {
  if (!import.meta.env.DEV) return
  console.info(`[urlSync] ${action} #${count}`)
}

class UrlSyncController implements UrlSync {
  private readonly deps: UrlSyncDeps
  private current: UrlWriteState = {
    ra: DEFAULT_RA,
    dec: DEFAULT_DEC,
    fov: DEFAULT_FOV,
    tool: 'map',
    embed: false,
  }
  private unknown: Array<[string, string]> = []
  private disposed = false
  private generation = 0
  /** Above zero while a URL-originated change is applied. Map events are ignored. */
  private suppress = 0
  private commanded: MapView | null = null
  private suppressToken = 0
  private suppressTimer: ReturnType<typeof setTimeout> | null = null
  private mapTimer: ReturnType<typeof setTimeout> | null = null
  private writeCount = 0

  private readonly onPopState = (): void => {
    if (this.disposed) return
    if (this.deps.win.location.pathname !== WORKSPACE_PATH) return
    void this.follow(parseUrl(this.deps.win.location.search))
  }

  constructor(deps: UrlSyncDeps) {
    this.deps = deps
    deps.win.addEventListener('popstate', this.onPopState)
  }

  async boot(): Promise<void> {
    if (this.disposed) return
    if (this.deps.win.location.pathname !== WORKSPACE_PATH) return
    await this.follow(parseUrl(this.deps.win.location.search))
  }

  onMapViewChanged(ra: number, dec: number, fov: number): void {
    if (this.disposed) return
    const view = this.normalize(ra, dec, fov)
    if (this.suppress > 0) {
      if (this.commanded && viewsMatch(view, this.commanded)) this.releaseSuppress()
      return
    }
    this.current.ra = view.ra
    this.current.dec = view.dec
    this.current.fov = view.fov
    this.scheduleReplace()
  }

  onToolChanged(tool: ToolId): void {
    if (this.disposed) return
    if (this.current.tool === tool) return
    this.current.tool = tool
    if (this.suppress > 0) return
    this.cancelMapTimer()
    this.write('push')
  }

  onSlugChanged(slug: string | null): void {
    if (this.disposed) return
    const next = slug && slug.length > 0 ? slug : undefined
    if (this.current.slug === next) return
    this.current.slug = next
    if (this.suppress > 0) return
    this.cancelMapTimer()
    this.write('push')
  }

  unknownParams(): readonly (readonly [string, string])[] {
    return this.unknown
  }

  dispose(): void {
    this.disposed = true
    this.generation += 1
    this.deps.win.removeEventListener('popstate', this.onPopState)
    this.cancelMapTimer()
    this.clearSuppressTimer()
    this.suppress = 0
    this.commanded = null
  }

  private async follow(parsed: ParsedUrl): Promise<void> {
    if (this.disposed) return
    const generation = ++this.generation
    this.unknown = parsed.unknown.map((pair) => [pair[0], pair[1]])

    if (parsed.slug === undefined && parsed.tool !== 'map' && parsed.ra !== undefined && parsed.dec !== undefined) {
      const view: MapView = {
        ra: parsed.ra,
        dec: parsed.dec,
        fov: parsed.fov ?? this.current.fov,
      }
      this.current = { ...view, tool: 'map', embed: parsed.embed }
      this.armSuppress(view)
      this.deps.createJobForCoordinate(parsed.ra, parsed.dec)
      this.deps.applyUrlState({ ...parsed, tool: 'map' })
      this.command(view)
      return
    }

    const view: MapView = {
      ra: parsed.ra ?? this.current.ra,
      dec: parsed.dec ?? this.current.dec,
      fov: parsed.fov ?? this.current.fov,
    }
    this.current = {
      ...view,
      tool: parsed.tool,
      embed: parsed.embed,
      ...(parsed.slug ? { slug: parsed.slug } : {}),
    }
    this.armSuppress(view)
    this.deps.applyUrlState(parsed)
    this.command(view)

    if (!parsed.slug) return
    const recenter = parsed.ra === undefined || parsed.dec === undefined
    await this.deps.loadDataset(parsed.slug, { recenter })
    if (this.disposed || generation !== this.generation) return
    const center = this.deps.getDatasetCenter()
    const nextRa = parsed.ra ?? center?.ra ?? this.current.ra
    const nextDec = parsed.dec ?? center?.dec ?? this.current.dec
    const nextFov = parsed.fov ?? this.current.fov
    this.current.ra = nextRa
    this.current.dec = nextDec
    this.current.fov = nextFov
    if (!recenter || !center) return
    this.deps.applyUrlState({ ...parsed, ra: nextRa, dec: nextDec, fov: nextFov })
    this.command({ ra: nextRa, dec: nextDec, fov: nextFov })
  }

  private normalize(ra: number, dec: number, fov: number): MapView {
    return {
      ra: Number.isFinite(ra) ? wrapRa(ra) : this.current.ra,
      dec: Number.isFinite(dec) ? clampDec(dec) : this.current.dec,
      fov: Number.isFinite(fov) ? clampFov(fov) : this.current.fov,
    }
  }

  private command(view: MapView): void {
    this.commanded = view
    this.deps.gotoRaDec(view.ra, view.dec)
    this.deps.setFov(view.fov)
  }

  private armSuppress(view: MapView): void {
    this.suppress += 1
    this.commanded = view
    const token = ++this.suppressToken
    this.clearSuppressTimer()
    this.suppressTimer = this.deps.setTimeout(() => {
      this.suppressTimer = null
      if (token !== this.suppressToken) return
      this.suppress = 0
      this.commanded = null
    }, SUPPRESS_MS)
  }

  private releaseSuppress(): void {
    if (this.suppress === 0) return
    this.suppress = 0
    this.commanded = null
    this.suppressToken += 1
    this.clearSuppressTimer()
  }

  private clearSuppressTimer(): void {
    if (this.suppressTimer === null) return
    this.deps.clearTimeout(this.suppressTimer)
    this.suppressTimer = null
  }

  private scheduleReplace(): void {
    if (this.mapTimer !== null) this.deps.clearTimeout(this.mapTimer)
    this.mapTimer = this.deps.setTimeout(() => {
      this.mapTimer = null
      this.write('replace')
    }, this.deps.debounceMs)
  }

  private cancelMapTimer(): void {
    if (this.mapTimer === null) return
    this.deps.clearTimeout(this.mapTimer)
    this.mapTimer = null
  }

  private write(action: 'push' | 'replace'): void {
    if (this.disposed) return
    const { location, history } = this.deps.win
    if (location.pathname !== WORKSPACE_PATH) return
    const next = buildWorkspaceUrl(location, this.current, this.unknown)
    const current = `${location.pathname}${location.search}${location.hash}`
    if (next === current) return
    if (action === 'push') history.pushState(null, '', next)
    else history.replaceState(null, '', next)
    this.writeCount += 1
    devLog(action === 'push' ? 'pushState' : 'replaceState', this.writeCount)
  }
}

export function createUrlSync(deps: UrlSyncDeps): UrlSync {
  return new UrlSyncController(deps)
}
