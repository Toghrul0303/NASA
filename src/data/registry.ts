/**
 * Fixed Tier 1 and Tier 1.5 slugs. FRONTEND_SPEC §6.2, DATA_CONTRACT §2.1.
 * Coordinates come from each dataset's meta.json. Nothing here is hard-coded.
 */
import { env } from '../config/env'
import type { Center } from '../contract/types'
import { ContractError, validateMeta } from '../contract/validate'
import { dataFileUrl, parseJsonBytes } from './dataset'

/** DATA_CONTRACT §2.1 tier1 slugs, in contract order. */
export const TIER1_SLUGS = ['barnards-star', 'wise-0855', 'eps-indi-b', 'rw-aur', 'r-dra'] as const

/** DATA_CONTRACT §2.1 tier1_5 slugs, in contract order. */
export const TIER1_5_SLUGS = ['tutorial-m101', 'tutorial-cosmos', 'tutorial-intro', 'tutorial-hips'] as const

export type RegistryTier = 'tier1' | 'tier1_5'

export interface RegistryEntry {
  slug: string
  tier: RegistryTier
  available: boolean
  title: string | null
  center: Center | null
  thumbUrl: string | null
}

const REGISTRY: readonly { slug: string; tier: RegistryTier }[] = [
  ...TIER1_SLUGS.map((slug) => ({ slug, tier: 'tier1' as const })),
  ...TIER1_5_SLUGS.map((slug) => ({ slug, tier: 'tier1_5' as const })),
]

export interface LoadRegistryOptions {
  dataBase?: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

function unavailable(slug: string, tier: RegistryTier): RegistryEntry {
  return { slug, tier, available: false, title: null, center: null, thumbUrl: null }
}

async function loadEntry(
  item: { slug: string; tier: RegistryTier },
  dataBase: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<RegistryEntry> {
  const init: RequestInit = { cache: 'no-cache' }
  if (signal) init.signal = signal
  let response: Response
  try {
    response = await fetchImpl(dataFileUrl(dataBase, item.slug, 'meta.json'), init)
  } catch (error) {
    if (error instanceof ContractError) throw error
    throw new ContractError('invalid', `GET meta.json failed for ${item.slug} with status unavailable`)
  }
  if (!response.ok) {
    const code = response.status === 404 ? 'not_found' : 'invalid'
    throw new ContractError(code, `GET meta.json failed for ${item.slug} with status ${response.status}`)
  }
  const bytes = await response.arrayBuffer()
  const meta = validateMeta(parseJsonBytes(bytes, 'meta.json'), item.slug)
  return {
    slug: item.slug,
    tier: item.tier,
    available: true,
    title: meta.title,
    center: meta.center,
    thumbUrl: dataFileUrl(dataBase, item.slug, meta.previews.thumb, meta.data_version),
  }
}

/**
 * Fetch each fixed slug's meta.json. A failed entry is returned with `available: false`
 * so the UI can show it disabled. No partial throw: one failure does not reject the list.
 */
export async function loadRegistry(opts?: LoadRegistryOptions): Promise<RegistryEntry[]> {
  const dataBase = opts?.dataBase ?? env.dataBase
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const signal = opts?.signal
  const settled = await Promise.allSettled(REGISTRY.map((item) => loadEntry(item, dataBase, fetchImpl, signal)))
  return REGISTRY.map((item, index) => {
    const result = settled[index]
    if (result === undefined || result.status === 'rejected') {
      console.error(`[data] ${item.slug} is unavailable`)
      return unavailable(item.slug, item.tier)
    }
    return result.value
  })
}
