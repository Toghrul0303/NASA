import type { Coadds, Frames, Gaia, Meta, Sed } from './types'

export type ContractErrorCode = 'unsupported_version' | 'not_found' | 'integrity_failed' | 'invalid'

export class ContractError extends Error {
  readonly code: ContractErrorCode

  constructor(code: ContractErrorCode, message: string) {
    super(message)
    this.name = 'ContractError'
    this.code = code
  }
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/

/** Major component of `major.minor.patch`, or null when the text is not that shape. */
export function parseSemverMajor(version: string): number | null {
  const match = SEMVER.exec(version)
  if (!match) return null
  const major = match[1]
  if (major === undefined) return null
  return Number(major)
}

export function isValidSlug(slug: string): boolean {
  return SLUG.test(slug)
}

type FieldKind = 'string' | 'number' | 'object' | 'array' | 'string|null' | 'object|null'

const META_FIELDS = [
  ['schema_version', 'string'],
  ['slug', 'string'],
  ['tier', 'string'],
  ['title', 'string'],
  ['status', 'string'],
  ['created_utc', 'string'],
  ['data_version', 'string'],
  ['pipeline_version', 'string'],
  ['target', 'object'],
  ['center', 'object'],
  ['observations', 'object'],
  ['grid', 'object'],
  ['binaries', 'object'],
  ['processing', 'object'],
  ['channels', 'array'],
  ['previews', 'object'],
  ['files', 'object'],
] as const satisfies ReadonlyArray<readonly [string, FieldKind]>

const FRAMES_FIELDS = [
  ['schema_version', 'string'],
  ['slug', 'string'],
  ['data_version', 'string'],
  ['n_frames', 'number'],
  ['epochs', 'array'],
  ['frames', 'array'],
] as const satisfies ReadonlyArray<readonly [string, FieldKind]>

const COADDS_FIELDS = [
  ['schema_version', 'string'],
  ['slug', 'string'],
  ['data_version', 'string'],
  ['n_coadds', 'number'],
  ['coadds', 'array'],
  ['rgb_presets', 'object'],
] as const satisfies ReadonlyArray<readonly [string, FieldKind]>

const SED_FIELDS = [
  ['schema_version', 'string'],
  ['slug', 'string'],
  ['data_version', 'string'],
  ['flux_unit', 'string'],
  ['wavelength_unit', 'string'],
  ['aperture_radii_px', 'array'],
  ['primary_aperture_index', 'number'],
  ['annulus_px', 'array'],
  ['solid_angle_source', 'string'],
  ['nominal_pixel_sr', 'number'],
  ['n_points', 'number'],
  ['points', 'array'],
] as const satisfies ReadonlyArray<readonly [string, FieldKind]>

const GAIA_FIELDS = [
  ['schema_version', 'string'],
  ['slug', 'string'],
  ['data_version', 'string'],
  ['query_status', 'string'],
  ['query', 'object'],
  ['match_radius_arcsec', 'number'],
  ['n_sources_in_cone', 'number'],
  ['verdict', 'string'],
  ['verdict_detail', 'string'],
  ['primary_source_id', 'string|null'],
  ['measured_pm', 'object|null'],
  ['consistency', 'object|null'],
  ['sources', 'array'],
] as const satisfies ReadonlyArray<readonly [string, FieldKind]>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

function kindOk(value: unknown, kind: FieldKind): boolean {
  switch (kind) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'object':
      return isRecord(value)
    case 'array':
      return Array.isArray(value)
    case 'string|null':
      return value === null || typeof value === 'string'
    case 'object|null':
      return value === null || isRecord(value)
    default:
      return false
  }
}

function requireField(rec: Record<string, unknown>, key: string, kind: FieldKind, label: string): void {
  if (!Object.hasOwn(rec, key)) {
    throw new ContractError('invalid', `${label} is missing ${key}`)
  }
  if (!kindOk(rec[key], kind)) {
    throw new ContractError('invalid', `${label}.${key} has the wrong type`)
  }
}

function requireSchemaVersion(rec: Record<string, unknown>, label: string): void {
  const version = rec.schema_version
  if (typeof version !== 'string') {
    throw new ContractError('invalid', `${label}.schema_version must be a string`)
  }
  const major = parseSemverMajor(version)
  if (major === null) {
    throw new ContractError('invalid', `${label}.schema_version must be major.minor.patch`)
  }
  if (major !== 1) {
    throw new ContractError('unsupported_version', 'unsupported data version')
  }
}

function checkDocument(
  x: unknown,
  label: string,
  fields: readonly (readonly [string, FieldKind])[],
): Record<string, unknown> {
  if (!isRecord(x)) throw new ContractError('invalid', `${label} must be an object`)
  requireSchemaVersion(x, label)
  for (const [key, kind] of fields) {
    requireField(x, key, kind, label)
  }
  if (typeof x.slug !== 'string' || typeof x.data_version !== 'string') {
    throw new ContractError('invalid', `${label} slug and data_version must be strings`)
  }
  return x
}

export function validateMeta(x: unknown, expectedSlug: string): Meta {
  const rec = checkDocument(x, 'meta', META_FIELDS)
  const slug = rec.slug
  if (typeof slug !== 'string' || !isValidSlug(slug) || slug !== expectedSlug) {
    throw new ContractError('invalid', 'meta.slug is invalid or does not match the requested dataset')
  }
  const status = rec.status
  if (status !== 'complete' && status !== 'partial') {
    throw new ContractError('invalid', 'meta.status must be complete or partial')
  }
  return rec as unknown as Meta
}

export function validateFrames(x: unknown): Frames {
  return checkDocument(x, 'frames', FRAMES_FIELDS) as unknown as Frames
}

export function validateCoadds(x: unknown): Coadds {
  return checkDocument(x, 'coadds', COADDS_FIELDS) as unknown as Coadds
}

export function validateSed(x: unknown): Sed {
  return checkDocument(x, 'sed', SED_FIELDS) as unknown as Sed
}

export function validateGaia(x: unknown): Gaia {
  const rec = checkDocument(x, 'gaia', GAIA_FIELDS)
  if (!isUnknownArray(rec.sources)) {
    throw new ContractError('invalid', 'gaia.sources must be an array')
  }
  for (const source of rec.sources) {
    if (!isRecord(source) || typeof source.source_id !== 'string') {
      throw new ContractError('invalid', 'Gaia source_id must be a string')
    }
  }
  return rec as unknown as Gaia
}
