/**
 * Static dataset load. FRONTEND_SPEC §6.1.
 * Any failure throws `ContractError` and returns no dataset.
 */
import { env } from '../config/env'
import type { Coadds, DatasetFiles, FileEntry, Frames, Gaia, Meta, Sed } from '../contract/types'
import {
  ContractError,
  validateCoadds,
  validateFrames,
  validateGaia,
  validateMeta,
  validateSed,
} from '../contract/validate'
import { assertLittleEndian, createBinaryReader } from '../core/binary'
import { sha256Hex } from '../core/hash'
import { buildIndexes, dataFileUrl, parseJsonBytes, previewUrls, type Dataset } from './dataset'

const DATA_FILES = ['frames.json', 'frames.bin', 'coadds.json', 'coadds.bin', 'sed.json', 'gaia.json'] as const

type DataFileName = (typeof DATA_FILES)[number]

type HashFn = (bytes: ArrayBuffer | Uint8Array) => Promise<string>

export interface LoadDatasetOptions {
  dataBase?: string
  fetchImpl?: typeof fetch
  hash?: HashFn
  signal?: AbortSignal
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function toContractError(error: unknown): ContractError {
  if (error instanceof ContractError) return error
  if (isAbort(error)) return new ContractError('invalid', 'dataset request was aborted')
  return new ContractError('invalid', 'dataset load failed')
}

function logFailure(error: ContractError): void {
  console.error(`[data] ${error.code}: ${error.message}`)
}

function isFileEntry(value: unknown): value is FileEntry {
  if (typeof value !== 'object' || value === null) return false
  const rec = value as Record<string, unknown>
  return typeof rec.bytes === 'number' && Number.isFinite(rec.bytes) && typeof rec.sha256 === 'string'
}

function fileEntry(files: DatasetFiles, name: DataFileName): FileEntry {
  const entry: unknown = (files as unknown as Record<string, unknown>)[name]
  if (!isFileEntry(entry)) {
    throw new ContractError('invalid', `meta.files is missing ${name}`)
  }
  return entry
}

async function fetchBytes(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  name: string,
  missingIsNotFound: boolean,
): Promise<ArrayBuffer> {
  let response: Response
  try {
    response = await fetchImpl(url, init)
  } catch (error) {
    if (error instanceof ContractError) throw error
    if (isAbort(error)) throw error
    throw new ContractError('invalid', `GET ${name} failed with status unavailable`)
  }
  if (!response.ok) {
    const message = `GET ${name} failed with status ${response.status}`
    if (missingIsNotFound && response.status === 404) throw new ContractError('not_found', message)
    throw new ContractError('invalid', message)
  }
  try {
    return await response.arrayBuffer()
  } catch (error) {
    if (isAbort(error)) throw error
    throw new ContractError('invalid', `GET ${name} failed with status unavailable`)
  }
}

async function assertIntegrity(
  name: DataFileName,
  bytes: ArrayBuffer,
  entry: FileEntry,
  meta: Meta,
  hash: HashFn,
): Promise<void> {
  if (bytes.byteLength !== entry.bytes) {
    throw new ContractError('integrity_failed', `${name} byte length ${bytes.byteLength} does not match ${entry.bytes}`)
  }
  if (name === 'frames.bin' && bytes.byteLength !== meta.binaries.frames.bytes) {
    throw new ContractError('integrity_failed', 'frames.bin byte length does not match meta.binaries.frames.bytes')
  }
  if (name === 'coadds.bin' && bytes.byteLength !== meta.binaries.coadds.bytes) {
    throw new ContractError('integrity_failed', 'coadds.bin byte length does not match meta.binaries.coadds.bytes')
  }
  const digest = await hash(bytes)
  if (digest !== entry.sha256) {
    throw new ContractError('integrity_failed', `${name} sha256 does not match meta.files`)
  }
}

function assertCrossFile(meta: Meta, frames: Frames, coadds: Coadds, sed: Sed, gaia: Gaia): void {
  const documents = [frames, coadds, sed, gaia]
  for (const doc of documents) {
    if (doc.data_version !== meta.data_version || doc.slug !== meta.slug) {
      throw new ContractError('integrity_failed', 'dataset files disagree on slug or data_version')
    }
  }
  if (frames.n_frames !== meta.observations.n_frames || frames.n_frames !== meta.binaries.frames.n_items) {
    throw new ContractError('integrity_failed', 'frame counts do not match')
  }
  if (coadds.n_coadds !== meta.binaries.coadds.n_items) {
    throw new ContractError('integrity_failed', 'coadd counts do not match')
  }
  if (sed.n_points !== frames.n_frames) {
    throw new ContractError('integrity_failed', 'sed point count does not match frames')
  }
  const width = meta.grid.width
  const height = meta.grid.height
  const binaries = [meta.binaries.frames, meta.binaries.coadds]
  for (const binary of binaries) {
    if (binary.width !== width || binary.height !== height) {
      throw new ContractError('integrity_failed', 'grid size does not match binaries')
    }
  }
}

async function load(slug: string, opts: LoadDatasetOptions): Promise<Dataset> {
  assertLittleEndian()

  const dataBase = opts.dataBase ?? env.dataBase
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const hash = opts.hash ?? sha256Hex
  const parent = opts.signal

  const metaInit: RequestInit = { cache: 'no-cache' }
  if (parent) metaInit.signal = parent
  const metaBytes = await fetchBytes(fetchImpl, dataFileUrl(dataBase, slug, 'meta.json'), metaInit, 'meta.json', true)
  const meta = validateMeta(parseJsonBytes(metaBytes, 'meta.json'), slug)

  for (const name of DATA_FILES) fileEntry(meta.files, name)

  const controller = new AbortController()
  const onParentAbort = () => controller.abort()
  if (parent) {
    if (parent.aborted) controller.abort()
    else parent.addEventListener('abort', onParentAbort)
  }

  const received = new Map<DataFileName, ArrayBuffer>()
  let primary: unknown
  try {
    const pairs = await Promise.all(
      DATA_FILES.map(async (name) => {
        try {
          const bytes = await fetchBytes(
            fetchImpl,
            dataFileUrl(dataBase, slug, name, meta.data_version),
            { signal: controller.signal },
            name,
            false,
          )
          return [name, bytes] as const
        } catch (error) {
          if (primary === undefined && !isAbort(error)) primary = error
          controller.abort()
          throw error
        }
      }),
    )
    for (const [name, bytes] of pairs) received.set(name, bytes)
  } catch (error) {
    controller.abort()
    throw primary ?? error
  } finally {
    parent?.removeEventListener('abort', onParentAbort)
  }

  for (const name of DATA_FILES) {
    const bytes = received.get(name)
    if (bytes === undefined) throw new ContractError('invalid', `meta.files is missing ${name}`)
    await assertIntegrity(name, bytes, fileEntry(meta.files, name), meta, hash)
  }

  const framesBytes = received.get('frames.json')
  const coaddsBytes = received.get('coadds.json')
  const sedBytes = received.get('sed.json')
  const gaiaBytes = received.get('gaia.json')
  const frameBuf = received.get('frames.bin')
  const coaddBuf = received.get('coadds.bin')
  if (!framesBytes || !coaddsBytes || !sedBytes || !gaiaBytes || !frameBuf || !coaddBuf) {
    throw new ContractError('invalid', 'dataset is missing a required file')
  }

  const frames = validateFrames(parseJsonBytes(framesBytes, 'frames.json'))
  const coadds = validateCoadds(parseJsonBytes(coaddsBytes, 'coadds.json'))
  const sed = validateSed(parseJsonBytes(sedBytes, 'sed.json'))
  const gaia = validateGaia(parseJsonBytes(gaiaBytes, 'gaia.json'))
  assertCrossFile(meta, frames, coadds, sed, gaia)

  const framesReader = createBinaryReader({
    buf: frameBuf,
    nItems: meta.binaries.frames.n_items,
    H: meta.binaries.frames.height,
    W: meta.binaries.frames.width,
    expectedBytes: meta.binaries.frames.bytes,
  })
  const coaddsReader = createBinaryReader({
    buf: coaddBuf,
    nItems: meta.binaries.coadds.n_items,
    H: meta.binaries.coadds.height,
    W: meta.binaries.coadds.width,
    expectedBytes: meta.binaries.coadds.bytes,
  })

  return {
    meta,
    frames,
    coadds,
    sed,
    gaia,
    frameBuf,
    coaddBuf,
    framesReader,
    coaddsReader,
    previews: previewUrls(dataBase, meta),
    ...buildIndexes(frames, coadds, sed),
  }
}

/** Load `/data/{slug}/`. Throws on any failure and never returns a partial dataset. */
export async function loadDataset(slug: string, opts?: LoadDatasetOptions): Promise<Dataset> {
  try {
    return await load(slug, opts ?? {})
  } catch (error) {
    const failure = toContractError(error)
    logFailure(failure)
    throw failure
  }
}
