// @vitest-environment node

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { datasetErrorMessage, loadErrors } from '../../src/config/copy'
import type { Meta } from '../../src/contract/types'
import { ContractError } from '../../src/contract/validate'
import { loadDataset } from '../../src/data/loader'
import { TIER1_5_SLUGS, TIER1_SLUGS, loadRegistry } from '../../src/data/registry'

const fixtureDir = fileURLToPath(new URL('../../public/data/fixture-barnard', import.meta.url))
const DATA_BASE = 'http://data.test'
const FIXTURE_SLUG = 'fixture-barnard'

const FILE_NAMES = [
  'meta.json',
  'frames.json',
  'frames.bin',
  'coadds.json',
  'coadds.bin',
  'sed.json',
  'gaia.json',
] as const

type FixtureName = (typeof FILE_NAMES)[number]

interface RecordedRequest {
  url: string
  cache: RequestCache | undefined
}

interface TamperResult {
  status: number
  body: Buffer
}

function readFixture(name: string): Buffer {
  return readFileSync(join(fixtureDir, name))
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function nodeHash(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buf =
    bytes instanceof Uint8Array ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : Buffer.from(bytes)
  return sha256(buf)
}

function createFetch(options?: {
  tamper?: (name: FixtureName, bytes: Buffer) => TamperResult | undefined
  /** Serve the fixture under this slug only, rewriting meta.slug. Every other slug is 404. */
  onlySlug?: string
}): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    requests.push({ url, cache: init?.cache })
    const parts = new URL(url).pathname.split('/').filter((part) => part.length > 0)
    const slug = parts[1]
    const name = parts[2]
    if (!slug || !name || !FILE_NAMES.includes(name as FixtureName)) {
      return new Response(null, { status: 404 })
    }
    const fileName = name as FixtureName
    if (options?.onlySlug !== undefined && slug !== options.onlySlug) {
      return new Response(null, { status: 404 })
    }
    let body = readFixture(fileName)
    if (fileName === 'meta.json' && options?.onlySlug !== undefined) {
      const json: unknown = JSON.parse(body.toString('utf8'))
      if (typeof json === 'object' && json !== null && !Array.isArray(json)) {
        ;(json as { slug: string }).slug = slug
        body = Buffer.from(JSON.stringify(json))
      }
    }
    const tampered = options?.tamper?.(fileName, body)
    if (tampered && tampered.status !== 200) return new Response(null, { status: tampered.status })
    if (tampered) body = tampered.body
    return new Response(new Uint8Array(body), { status: 200 })
  }
  return { fetchImpl, requests }
}

function loadOptions(fetchImpl: typeof fetch) {
  return { dataBase: DATA_BASE, fetchImpl, hash: nodeHash }
}

async function loadFailure(
  tamper: (name: FixtureName, bytes: Buffer) => TamperResult | undefined,
): Promise<ContractError> {
  const { fetchImpl } = createFetch({ tamper })
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await loadDataset(FIXTURE_SLUG, loadOptions(fetchImpl))
  } catch (error) {
    expect(error).toBeInstanceOf(ContractError)
    if (!(error instanceof ContractError)) throw error
    const logged = spy.mock.calls.map((call) => call.map((part) => String(part)).join(' ')).join('\n')
    expect(logged).toContain('[data]')
    expect(logged).not.toContain('{')
    return error
  } finally {
    spy.mockRestore()
  }
  throw new Error('expected ContractError')
}

describe('dataset error copy', () => {
  it('maps each ContractError code to its sentence', () => {
    expect(datasetErrorMessage('not_found')).toBe(loadErrors.not_found)
    expect(loadErrors.not_found).toBe('This dataset does not exist.')
    expect(loadErrors.integrity_failed).toBe('The dataset failed an integrity check and was not loaded.')
    expect(loadErrors.unsupported_version).toBe('Unsupported data version.')
    expect(loadErrors.invalid).toBe('The dataset is invalid and was not loaded.')
  })
})

describe('loadDataset', () => {
  it('loads the fixture and builds indexes', async () => {
    const { fetchImpl, requests } = createFetch()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const dataset = await loadDataset(FIXTURE_SLUG, loadOptions(fetchImpl))
      expect(dataset.frames.n_frames).toBe(dataset.meta.observations.n_frames)
      expect(dataset.frames.n_frames).toBe(dataset.meta.binaries.frames.n_items)
      expect(dataset.frames.frames).toHaveLength(dataset.frames.n_frames)
      expect(dataset.coadds.n_coadds).toBe(dataset.meta.binaries.coadds.n_items)
      expect(dataset.coadds.coadds).toHaveLength(dataset.coadds.n_coadds)
      expect(dataset.sed.n_points).toBe(dataset.frames.n_frames)

      const detectorFrames = dataset.framesByDetector[1]
      expect(detectorFrames).toHaveLength(6)
      for (let i = 1; i < detectorFrames.length; i += 1) {
        const previous = detectorFrames[i - 1]
        const current = detectorFrames[i]
        expect(previous).toBeDefined()
        expect(current).toBeDefined()
        if (!previous || !current) continue
        expect(current.mjd).toBeGreaterThanOrEqual(previous.mjd)
      }

      expect(dataset.epochById.size).toBe(3)
      expect(dataset.coaddByKey.has('ed:0:1')).toBe(true)
      expect(dataset.coaddByKey.has('d:1')).toBe(true)
      expect([...dataset.coaddByKey.keys()].some((key) => key.startsWith('c:'))).toBe(true)

      expect(dataset.sedByFrame).toHaveLength(dataset.frames.frames.length)
      for (const frame of dataset.frames.frames) {
        expect(dataset.sedByFrame[frame.index]?.frame_index).toBe(frame.index)
      }
      expect(dataset.previews.rgb_detector).toBeNull()
      expect(spy).not.toHaveBeenCalled()

      const metaCall = requests[0]
      expect(metaCall).toBeDefined()
      if (!metaCall) return
      expect(metaCall.url).toBe(`${DATA_BASE}/data/${FIXTURE_SLUG}/meta.json`)
      expect(metaCall.url).not.toContain('?v')
      expect(metaCall.cache).toBe('no-cache')

      const version = encodeURIComponent(dataset.meta.data_version)
      const rest = requests.slice(1)
      expect(rest).toHaveLength(6)
      for (const call of rest) {
        expect(call.url).toContain(`?v=${version}`)
      }
    } finally {
      spy.mockRestore()
    }
  })

  it('rejects a flipped frames.bin byte with integrity_failed', async () => {
    const error = await loadFailure((name, bytes) => {
      if (name !== 'frames.bin') return undefined
      const body = Buffer.from(bytes)
      body[0] = (body[0] ?? 0) ^ 0xff
      return { status: 200, body }
    })
    expect(error.code).toBe('integrity_failed')
  })

  it('rejects a truncated coadds.bin with integrity_failed', async () => {
    const error = await loadFailure((name, bytes) => {
      if (name !== 'coadds.bin') return undefined
      return { status: 200, body: Buffer.from(bytes.subarray(0, bytes.length - 2)) }
    })
    expect(error.code).toBe('integrity_failed')
  })

  it('rejects a wrong meta.files byte length with integrity_failed', async () => {
    const error = await loadFailure((name, bytes) => {
      if (name !== 'meta.json') return undefined
      const json: unknown = JSON.parse(bytes.toString('utf8'))
      if (typeof json !== 'object' || json === null || Array.isArray(json)) return undefined
      const files = (json as { files?: { 'frames.json'?: { bytes?: number } } }).files
      const entry = files?.['frames.json']
      if (!entry || typeof entry.bytes !== 'number') return undefined
      entry.bytes += 1
      return { status: 200, body: Buffer.from(JSON.stringify(json)) }
    })
    expect(error.code).toBe('integrity_failed')
  })

  it('rejects a sed.json data_version that disagrees with meta', async () => {
    const original = JSON.parse(readFixture('sed.json').toString('utf8')) as { data_version: string }
    original.data_version = `${original.data_version}-other`
    const sedBody = Buffer.from(JSON.stringify(original))
    const error = await loadFailure((name, bytes) => {
      if (name === 'sed.json') return { status: 200, body: sedBody }
      if (name !== 'meta.json') return undefined
      const json: unknown = JSON.parse(bytes.toString('utf8'))
      if (typeof json !== 'object' || json === null || Array.isArray(json)) return undefined
      const files = (json as Meta).files
      files['sed.json'] = { bytes: sedBody.length, sha256: sha256(sedBody) }
      return { status: 200, body: Buffer.from(JSON.stringify(json)) }
    })
    expect(error.code).toBe('integrity_failed')
  })

  it('rejects meta schema major 2 with unsupported_version', async () => {
    const error = await loadFailure((name, bytes) => {
      if (name !== 'meta.json') return undefined
      const json: unknown = JSON.parse(bytes.toString('utf8'))
      if (typeof json !== 'object' || json === null || Array.isArray(json)) return undefined
      ;(json as { schema_version: string }).schema_version = '2.0.0'
      return { status: 200, body: Buffer.from(JSON.stringify(json)) }
    })
    expect(error.code).toBe('unsupported_version')
  })

  it('maps a missing meta.json to not_found', async () => {
    const error = await loadFailure((name) => {
      if (name !== 'meta.json') return undefined
      return { status: 404, body: Buffer.alloc(0) }
    })
    expect(error.code).toBe('not_found')
  })

  it('fails the whole load when gaia.json is missing', async () => {
    const error = await loadFailure((name) => {
      if (name !== 'gaia.json') return undefined
      return { status: 404, body: Buffer.alloc(0) }
    })
    expect(error).toBeInstanceOf(ContractError)
    expect(error.message).toContain('404')
  })
})

describe('loadRegistry', () => {
  it('marks every slug except the one served fixture as unavailable', async () => {
    const meta = JSON.parse(readFixture('meta.json').toString('utf8')) as Meta
    const { fetchImpl } = createFetch({ onlySlug: 'barnards-star' })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const entries = await loadRegistry({ dataBase: DATA_BASE, fetchImpl })
      expect(entries).toHaveLength(TIER1_SLUGS.length + TIER1_5_SLUGS.length)
      const available = entries.filter((entry) => entry.available)
      expect(available).toHaveLength(1)
      const hit = available[0]
      expect(hit).toBeDefined()
      if (!hit) return
      expect(hit.slug).toBe('barnards-star')
      expect(hit.tier).toBe('tier1')
      expect(hit.title).toBe(meta.title)
      expect(hit.center).toEqual(meta.center)
      expect(hit.thumbUrl).toContain('/data/barnards-star/previews/thumb.png?v=')
      for (const entry of entries) {
        if (entry.available) continue
        expect(entry.title).toBeNull()
        expect(entry.center).toBeNull()
        expect(entry.thumbUrl).toBeNull()
      }
    } finally {
      spy.mockRestore()
    }
  })
})
