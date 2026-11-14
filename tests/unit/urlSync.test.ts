// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildWorkspaceUrl,
  createUrlSync,
  parseUrl,
  serializeUrl,
  type UrlSyncDeps,
  type UrlSyncWindow,
} from '../../src/state/urlSync'
import type { ToolId } from '../../src/config/tools'

function timers(): Pick<UrlSyncDeps, 'setTimeout' | 'clearTimeout'> {
  return {
    setTimeout: (handler, timeout) => setTimeout(handler, timeout),
    clearTimeout: (id) => clearTimeout(id),
  }
}

interface FakeBrowser {
  win: UrlSyncWindow
  pushes: string[]
  replaces: string[]
  emitPop: () => void
}

function fakeBrowser(initial?: { pathname?: string; search?: string; hash?: string }): FakeBrowser {
  const location = {
    pathname: initial?.pathname ?? '/workspace',
    search: initial?.search ?? '',
    hash: initial?.hash ?? '',
  }
  const pushes: string[] = []
  const replaces: string[] = []
  const listeners = new Set<(event: Event) => void>()

  function apply(url?: string | URL | null): void {
    if (url == null) return
    const text = String(url)
    const hashAt = text.indexOf('#')
    const hash = hashAt >= 0 ? text.slice(hashAt) : ''
    const before = hashAt >= 0 ? text.slice(0, hashAt) : text
    const queryAt = before.indexOf('?')
    location.pathname = queryAt >= 0 ? before.slice(0, queryAt) : before
    location.search = queryAt >= 0 ? before.slice(queryAt) : ''
    location.hash = hash
  }

  const win: UrlSyncWindow = {
    location,
    history: {
      pushState(_data, _unused, url) {
        apply(url)
        pushes.push(String(url))
      },
      replaceState(_data, _unused, url) {
        apply(url)
        replaces.push(String(url))
      },
    },
    addEventListener(type, listener) {
      if (type === 'popstate') listeners.add(listener)
    },
    removeEventListener(type, listener) {
      if (type === 'popstate') listeners.delete(listener)
    },
  }

  return {
    win,
    pushes,
    replaces,
    emitPop() {
      const event = new Event('popstate')
      for (const listener of listeners) listener(event)
    },
  }
}

function harness(browser: FakeBrowser, overrides?: Partial<UrlSyncDeps>) {
  const applyUrlState = vi.fn<UrlSyncDeps['applyUrlState']>()
  const gotoRaDec = vi.fn<UrlSyncDeps['gotoRaDec']>()
  const setFov = vi.fn<UrlSyncDeps['setFov']>()
  const loadDataset = vi.fn<UrlSyncDeps['loadDataset']>(async () => undefined)
  const getDatasetCenter = vi.fn<UrlSyncDeps['getDatasetCenter']>(() => null)
  const createJobForCoordinate = vi.fn<UrlSyncDeps['createJobForCoordinate']>()
  const sync = createUrlSync({
    win: browser.win,
    ...timers(),
    debounceMs: 250,
    applyUrlState,
    gotoRaDec,
    setFov,
    loadDataset,
    getDatasetCenter,
    createJobForCoordinate,
    ...overrides,
  })
  return { sync, applyUrlState, gotoRaDec, setFov, loadDataset, getDatasetCenter, createJobForCoordinate }
}

describe('parseUrl', () => {
  it('wraps ra, clamps dec and fov, and drops non-finite numbers', () => {
    const wrapped = parseUrl('?ra=-10&dec=4')
    expect(wrapped.ra).toBe(350)
    expect(parseUrl('?ra=360').ra).toBe(0)
    expect(parseUrl('?ra=720.5').ra).toBe(0.5)

    expect(parseUrl('?dec=95').dec).toBe(90)
    expect(parseUrl('?dec=-100').dec).toBe(-90)

    expect(parseUrl('?fov=0.001').fov).toBe(0.01)
    expect(parseUrl('?fov=500').fov).toBe(180)

    const broken = parseUrl('?ra=NaN&dec=Infinity&fov=foo')
    expect(broken.ra).toBeUndefined()
    expect(broken.dec).toBeUndefined()
    expect(broken.fov).toBeUndefined()
  })

  it('maps an unknown tool to map, drops an invalid slug, and accepts embed only for 1', () => {
    expect(parseUrl('?tool=nonsense').tool).toBe('map')
    expect(parseUrl('?tool=blink').tool).toBe('blink')
    expect(parseUrl('').tool).toBe('map')

    expect(parseUrl('?slug=Bad_Slug').slug).toBeUndefined()
    expect(parseUrl('?slug=fixture-barnard').slug).toBe('fixture-barnard')

    expect(parseUrl('?embed=1').embed).toBe(true)
    expect(parseUrl('?embed=true').embed).toBe(false)
    expect(parseUrl('?embed=0').embed).toBe(false)
    expect(parseUrl('').embed).toBe(false)
  })

  it('keeps unknown parameters in their original order', () => {
    const parsed = parseUrl('?devGaia=consistent&ra=1&z=9&tool=blink')
    expect(parsed.unknown).toEqual([
      ['devGaia', 'consistent'],
      ['z', '9'],
    ])
    expect(parsed.ra).toBe(1)
    expect(parsed.tool).toBe('blink')
  })
})

describe('serializeUrl', () => {
  const state = {
    ra: 269.452,
    dec: 4.69,
    fov: 0.5,
    tool: 'blink' as ToolId,
    slug: 'fixture-barnard',
    embed: true,
  }

  it('writes the canonical order, trims zeros, and keeps unknown parameters in order', () => {
    const query = serializeUrl(state, [
      ['devGaia', 'consistent'],
      ['z', '1'],
    ])
    expect(query).toBe('?ra=269.452&dec=4.69&fov=0.5&tool=blink&slug=fixture-barnard&embed=1&devGaia=consistent&z=1')
  })

  it('omits the map tool, an unset slug, and an absent embed', () => {
    expect(
      serializeUrl({ ra: 1, dec: 2, fov: 0.25, tool: 'map', embed: false }, []),
    ).toBe('?ra=1&dec=2&fov=0.25')
  })

  it('wraps ra after rounding and never emits -0', () => {
    expect(serializeUrl({ ra: 359.9999996, dec: 0, fov: 0.5, tool: 'map', embed: false }, []).startsWith('?ra=0&')).toBe(
      true,
    )
    expect(serializeUrl({ ra: 359.9999996, dec: 0, fov: 0.5, tool: 'map', embed: false }, [])).not.toContain('360')
    const negativeZero = serializeUrl({ ra: 1, dec: -0.0000001, fov: 0.5, tool: 'map', embed: false }, [])
    expect(negativeZero).toContain('dec=0')
    expect(negativeZero).not.toContain('-0')
    expect(negativeZero).not.toMatch(/[0-9]e[+-]/i)
  })

  it('preserves pathname and hash around the query', () => {
    const url = buildWorkspaceUrl(
      { pathname: '/workspace', hash: '#panel' },
      { ra: 10, dec: -4.5, fov: 1.25, tool: 'sed', slug: 'fixture-barnard', embed: false },
      [['devGaia', 'consistent']],
    )
    expect(url).toBe('/workspace?ra=10&dec=-4.5&fov=1.25&tool=sed&slug=fixture-barnard&devGaia=consistent#panel')
  })
})

describe('url sync controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces rapid map events into one replaceState after 250 ms', () => {
    const browser = fakeBrowser({ hash: '#keep' })
    const { sync } = harness(browser)
    for (let index = 0; index < 10; index += 1) {
      sync.onMapViewChanged(10 + index, 4.5, 0.25)
    }
    expect(browser.replaces).toHaveLength(0)
    vi.advanceTimersByTime(249)
    expect(browser.replaces).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(browser.replaces).toHaveLength(1)
    expect(browser.pushes).toHaveLength(0)
    expect(browser.replaces[0]).toBe('/workspace?ra=19&dec=4.5&fov=0.25#keep')
    sync.dispose()
  })

  it('pushes one history entry per tool or slug change and skips an unchanged value', async () => {
    const browser = fakeBrowser({ search: '?ra=1&dec=2&fov=0.5', hash: '#sky' })
    const { sync } = harness(browser)
    await sync.boot()
    sync.onMapViewChanged(1, 2, 0.5)
    sync.onToolChanged('blink')
    sync.onToolChanged('blink')
    expect(browser.pushes).toEqual(['/workspace?ra=1&dec=2&fov=0.5&tool=blink#sky'])
    sync.onSlugChanged('fixture-barnard')
    sync.onSlugChanged('fixture-barnard')
    expect(browser.pushes).toHaveLength(2)
    expect(browser.pushes[1]).toBe('/workspace?ra=1&dec=2&fov=0.5&tool=blink&slug=fixture-barnard#sky')
    expect(browser.replaces).toHaveLength(0)
    sync.dispose()
  })

  it('applies popstate to the store and the map without writing history', () => {
    const browser = fakeBrowser()
    const { sync, applyUrlState, gotoRaDec, setFov } = harness(browser)
    browser.win.location.search = '?ra=10&dec=4&fov=1&tool=blink&slug=fixture-barnard&devGaia=consistent'
    browser.emitPop()
    expect(applyUrlState).toHaveBeenCalledTimes(1)
    expect(applyUrlState.mock.calls[0]?.[0]).toMatchObject({
      ra: 10,
      dec: 4,
      fov: 1,
      tool: 'blink',
      slug: 'fixture-barnard',
      embed: false,
    })
    expect(gotoRaDec).toHaveBeenCalledTimes(1)
    expect(gotoRaDec).toHaveBeenCalledWith(10, 4)
    expect(setFov).toHaveBeenCalledTimes(1)
    expect(setFov).toHaveBeenCalledWith(1)

    sync.onMapViewChanged(12, 4, 1)
    sync.onMapViewChanged(10, 4, 1)
    vi.advanceTimersByTime(250)
    expect(browser.pushes).toHaveLength(0)
    expect(browser.replaces).toHaveLength(0)

    vi.advanceTimersByTime(600)
    sync.onMapViewChanged(15, 4, 1)
    vi.advanceTimersByTime(250)
    expect(browser.replaces).toHaveLength(1)
    sync.dispose()
  })

  it('ignores popstate when the pathname is not /workspace', () => {
    const browser = fakeBrowser({ pathname: '/', search: '?tool=sed&ra=1&dec=2' })
    const { sync, applyUrlState, gotoRaDec, setFov } = harness(browser)
    browser.emitPop()
    expect(applyUrlState).not.toHaveBeenCalled()
    expect(gotoRaDec).not.toHaveBeenCalled()
    expect(setFov).not.toHaveBeenCalled()
    expect(browser.pushes).toHaveLength(0)
    expect(browser.replaces).toHaveLength(0)
    sync.dispose()
  })
})
