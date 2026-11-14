import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CubeConfig, MapAdapter } from '../../src/map/aladinAdapter'
import {
  CUBE_PROBE_SLICE,
  CUBE_PROBE_TIMEOUT_MS,
  DICHROIC_CHANNELS,
  bandAndChannel,
  isDichroicChannel,
  probe,
  probeBaselineChannel,
  resolveChannelInput,
  stepValidChannel,
  validChannels,
} from '../../src/map/cubeLayer'

const srcRoot = fileURLToPath(new URL('../../src', import.meta.url))

function sourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(path))
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) files.push(path)
  }
  return files
}

function adapterWith(setCube: MapAdapter['setCube']): MapAdapter {
  return {
    init: async () => undefined,
    gotoRaDec: () => undefined,
    setFov: () => undefined,
    getView: () => ({ ra: 0, dec: 0, fov: 0.5 }),
    onViewChange: () => () => undefined,
    onClick: () => () => undefined,
    setFootprint: () => undefined,
    setGaiaSources: () => undefined,
    setGaiaTrack: () => undefined,
    setCube,
    destroy: () => undefined,
  }
}

describe('aladin import boundary', () => {
  it('imports aladin-lite only from the adapter', () => {
    const pattern = /(?:from\s+|import\s*\(\s*)['"]aladin-lite['"]/
    const importers = sourceFiles(srcRoot).filter((file) => pattern.test(readFileSync(file, 'utf8')))
    expect(importers.map((file) => file.replaceAll('\\', '/'))).toEqual([expect.stringMatching(/\/aladinAdapter\.ts$/)])
  })
})

describe('cube channels', () => {
  it('skips the dichroic gap and addresses slice 62 as band 4 channel 12', () => {
    expect(DICHROIC_CHANNELS).toEqual([50, 51])
    expect(validChannels()).toHaveLength(100)
    expect(validChannels()).not.toContain(50)
    expect(validChannels()).not.toContain(51)
    expect(isDichroicChannel(CUBE_PROBE_SLICE)).toBe(false)
    expect(bandAndChannel(62)).toEqual({ band: 4, bandChannel: 12 })
    expect(bandAndChannel(50)).toEqual({ band: 3, bandChannel: 17 })
    expect(probeBaselineChannel()).toBe(61)
    expect(probeBaselineChannel(52)).toBe(49)
    expect(stepValidChannel(49, 1)).toEqual({ channel: 52, crossedDichroic: true })
    expect(stepValidChannel(52, -1)).toEqual({ channel: 49, crossedDichroic: true })
    expect(stepValidChannel(10, 1)).toEqual({ channel: 11, crossedDichroic: false })
    expect(resolveChannelInput(50)).toEqual({ ok: false, dichroic: true })
    expect(resolveChannelInput(51)).toEqual({ ok: false, dichroic: true })
    expect(resolveChannelInput(62)).toEqual({ ok: true, channel: 62 })
    expect(CUBE_PROBE_TIMEOUT_MS).toBe(10_000)
  })
})

describe('Gate G1 probe', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stays off when the flag is false and does not load a cube', async () => {
    const setCube = vi.fn<MapAdapter['setCube']>()
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await expect(probe(adapterWith(setCube), { enabled: false, url: 'https://example.test/hips' })).resolves.toBe(false)
    expect(setCube).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })

  it('stays off when the HiPS URL is unset', async () => {
    const setCube = vi.fn<MapAdapter['setCube']>()
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await expect(probe(adapterWith(setCube), { enabled: true })).resolves.toBe(false)
    expect(setCube).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith('[map] Cube control disabled')
  })

  it('switches to slice 62, skips channels 50 and 51, and restores the base survey', async () => {
    const calls: Array<CubeConfig | null> = []
    const setCube = vi.fn<MapAdapter['setCube']>(async (cfg) => {
      calls.push(cfg)
    })
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await expect(probe(adapterWith(setCube), { enabled: true, url: 'https://example.test/hips' })).resolves.toBe(true)
    expect(calls).toEqual([
      { url: 'https://example.test/hips', channel: 61 },
      { url: 'https://example.test/hips', channel: 62 },
      null,
    ])
    expect(calls.some((call) => call !== null && (call.channel === 50 || call.channel === 51))).toBe(false)
    expect(info).not.toHaveBeenCalled()
  })

  it('disables the control when the slice switch fails', async () => {
    const calls: Array<CubeConfig | null> = []
    const setCube = vi.fn<MapAdapter['setCube']>(async (cfg) => {
      calls.push(cfg)
      if (cfg !== null) throw new Error('cube unavailable')
    })
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await expect(probe(adapterWith(setCube), { enabled: true, url: 'https://example.test/hips' })).resolves.toBe(false)
    expect(calls.at(-1)).toBeNull()
    expect(info).toHaveBeenCalledWith('[map] Cube control disabled', expect.any(Error))
  })

  it('disables the control when the probe times out', async () => {
    const calls: Array<CubeConfig | null> = []
    const setCube = vi.fn<MapAdapter['setCube']>(async (cfg) => {
      calls.push(cfg)
      if (cfg !== null) await new Promise(() => undefined)
    })
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await expect(
      probe(adapterWith(setCube), { enabled: true, url: 'https://example.test/hips', timeoutMs: 20 }),
    ).resolves.toBe(false)
    expect(calls).toContain(null)
    expect(info).toHaveBeenCalledWith('[map] Cube control disabled')
  })
})
