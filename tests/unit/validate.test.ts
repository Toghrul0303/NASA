// @vitest-environment node

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ContractError,
  isValidSlug,
  parseSemverMajor,
  validateCoadds,
  validateFrames,
  validateGaia,
  validateMeta,
  validateSed,
} from '../../src/contract/validate'

const fixtureDir = fileURLToPath(new URL('../../public/data/fixture-barnard', import.meta.url))

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtureDir, name), 'utf8')) as unknown
}

function withFields(value: unknown, patch: object): unknown {
  const copy: unknown = JSON.parse(JSON.stringify(value))
  if (typeof copy !== 'object' || copy === null || Array.isArray(copy)) throw new Error('expected object')
  Object.assign(copy, patch)
  return copy
}

function withoutKey(value: unknown, key: string): unknown {
  const copy: unknown = JSON.parse(JSON.stringify(value))
  if (typeof copy !== 'object' || copy === null || Array.isArray(copy)) throw new Error('expected object')
  const rec = copy as unknown as Record<string, unknown>
  delete rec[key]
  return rec
}

function thrown(run: () => void): ContractError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(ContractError)
    if (!(error instanceof ContractError)) throw error
    return error
  }
  throw new Error('expected ContractError')
}

describe('contract helpers', () => {
  it('parses a semver major and checks slugs', () => {
    expect(parseSemverMajor('1.3.0')).toBe(1)
    expect(parseSemverMajor('2.0.0')).toBe(2)
    expect(parseSemverMajor('1')).toBeNull()
    expect(isValidSlug('fixture-barnard')).toBe(true)
    expect(isValidSlug('Bad_Slug')).toBe(false)
  })
})

describe('fixture validators', () => {
  const meta = readJson('meta.json')
  const frames = readJson('frames.json')
  const coadds = readJson('coadds.json')
  const sed = readJson('sed.json')
  const gaia = readJson('gaia.json')

  it('accepts every fixture JSON file', () => {
    expect(validateMeta(meta, 'fixture-barnard').slug).toBe('fixture-barnard')
    expect(validateFrames(frames).n_frames).toBeGreaterThan(0)
    expect(validateCoadds(coadds).n_coadds).toBeGreaterThan(0)
    expect(validateSed(sed).n_points).toBeGreaterThan(0)
    expect(validateGaia(gaia).query_status).toBe('ok')
  })

  it('rejects a different schema major and accepts a minor bump with an unknown field', () => {
    const unsupported = thrown(() => validateMeta(withFields(meta, { schema_version: '2.0.0' }), 'fixture-barnard'))
    expect(unsupported.code).toBe('unsupported_version')

    const input = withFields(meta, { schema_version: '1.3.0', extra_field: true })
    const accepted = validateMeta(input, 'fixture-barnard')
    expect(accepted.schema_version).toBe('1.3.0')
    expect(accepted).toBe(input)
    expect(Object.hasOwn(accepted, 'extra_field')).toBe(true)
  })

  it('rejects a slug mismatch, an invalid slug, and a status other than complete or partial', () => {
    expect(thrown(() => validateMeta(meta, 'barnards-star')).code).toBe('invalid')
    expect(thrown(() => validateMeta(withFields(meta, { slug: 'Bad_Slug' }), 'Bad_Slug')).code).toBe('invalid')
    expect(thrown(() => validateMeta(withFields(meta, { status: 'running' }), 'fixture-barnard')).code).toBe('invalid')
    expect(validateMeta(withFields(meta, { status: 'partial' }), 'fixture-barnard').status).toBe('partial')
  })

  it('rejects a missing required key', () => {
    expect(thrown(() => validateMeta(withoutKey(meta, 'title'), 'fixture-barnard')).code).toBe('invalid')
  })

  it('rejects a numeric Gaia source_id', () => {
    const edited = JSON.parse(JSON.stringify(gaia)) as unknown as {
      sources: Array<{ source_id: string | number }>
    }
    const source = edited.sources[0]
    if (!source) throw new Error('fixture gaia has no sources')
    source.source_id = 12345
    expect(thrown(() => validateGaia(edited)).code).toBe('invalid')
  })
})
