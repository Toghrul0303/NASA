/**
 * In-memory Gaia documents for the four verdict states. DEV only.
 * Fields follow DATA_CONTRACT §9.2. The panel does not recompute them.
 */
import type { Gaia, GaiaSource, MeasuredPm, PredictedTrackPoint } from '../contract/types'

export const GAIA_SAMPLE_KINDS = ['consistent', 'inconsistent', 'no_counterpart', 'unavailable'] as const

export type GaiaSampleKind = (typeof GAIA_SAMPLE_KINDS)[number]

/** 19-digit Gaia source id. It stays a string in every sample. */
export const GAIA_SAMPLE_SOURCE_ID = '4472832130942575872'

export function isGaiaSampleKind(value: string | null): value is GaiaSampleKind {
  return (
    value === 'consistent' ||
    value === 'inconsistent' ||
    value === 'no_counterpart' ||
    value === 'unavailable'
  )
}

function sampleMeasuredPm(): MeasuredPm {
  return {
    pmra_mas_yr: -790,
    pmdec_mas_yr: 10340,
    pmra_err_mas_yr: 25,
    pmdec_err_mas_yr: 25,
    n_frames_used: 6,
    n_epochs_used: 3,
    baseline_days: 320,
    method: 'weighted_linear_centroid',
  }
}

function fallbackTrack(source: Pick<GaiaSource, 'ra_deg' | 'dec_deg'>): PredictedTrackPoint[] {
  return [
    { epoch_id: 0, mjd: 60000, ra_deg: source.ra_deg, dec_deg: source.dec_deg, x: 1, y: 1 },
    { epoch_id: 1, mjd: 60180, ra_deg: source.ra_deg, dec_deg: source.dec_deg, x: 2, y: 2 },
  ]
}

function ensurePrimary(sources: readonly GaiaSource[]): GaiaSource {
  const found =
    sources.find((source) => source.source_id === GAIA_SAMPLE_SOURCE_ID) ??
    sources.find((source) => source.is_primary) ??
    sources[0]
  const ra = found?.ra_deg ?? 0
  const dec = found?.dec_deg ?? 0
  const track = found?.predicted_track
  return {
    source_id: GAIA_SAMPLE_SOURCE_ID,
    ra_deg: ra,
    dec_deg: dec,
    ref_epoch_year: found?.ref_epoch_year ?? 2016,
    pmra_mas_yr: found?.pmra_mas_yr ?? -803,
    pmdec_mas_yr: found?.pmdec_mas_yr ?? 10362,
    parallax_mas: found?.parallax_mas ?? null,
    parallax_error_mas: found?.parallax_error_mas ?? null,
    phot_g_mean_mag: found?.phot_g_mean_mag ?? null,
    separation_arcsec: found?.separation_arcsec ?? 0,
    is_primary: true,
    predicted_track: track && track.length > 0 ? track : fallbackTrack({ ra_deg: ra, dec_deg: dec }),
  }
}

/**
 * A Gaia document of `kind` built from `base`.
 * `verdict_detail` is copied through unchanged.
 */
export function makeGaiaSample(base: Gaia, kind: GaiaSampleKind): Gaia {
  const gaia = structuredClone(base)
  const verdictDetail = base.verdict_detail

  if (kind === 'unavailable') {
    return {
      ...gaia,
      query_status: 'unavailable',
      verdict: 'unavailable',
      verdict_detail: verdictDetail,
      n_sources_in_cone: 0,
      primary_source_id: null,
      measured_pm: null,
      consistency: null,
      sources: [],
    }
  }

  if (kind === 'no_counterpart') {
    const seed = gaia.sources.length > 0 ? gaia.sources : [ensurePrimary(gaia.sources)]
    const sources = seed.map((source, index) => ({
      ...source,
      source_id: index === 0 ? GAIA_SAMPLE_SOURCE_ID : source.source_id,
      is_primary: false,
      predicted_track: null,
    }))
    return {
      ...gaia,
      query_status: 'ok',
      verdict: 'no_counterpart',
      verdict_detail: verdictDetail,
      n_sources_in_cone: sources.length,
      primary_source_id: null,
      measured_pm: null,
      consistency: null,
      sources,
    }
  }

  const primary = ensurePrimary(gaia.sources)
  const others = gaia.sources
    .filter((source) => source.source_id !== primary.source_id && source.source_id !== GAIA_SAMPLE_SOURCE_ID)
    .map((source) => ({ ...source, is_primary: false, predicted_track: null }))
  const sources = [primary, ...others]
  const within = kind === 'consistent'
  return {
    ...gaia,
    query_status: 'ok',
    verdict: within ? 'match_consistent' : 'match_inconsistent',
    verdict_detail: verdictDetail,
    n_sources_in_cone: sources.length,
    primary_source_id: primary.source_id,
    measured_pm: sampleMeasuredPm(),
    consistency: {
      delta_pmra_mas_yr: within ? 12 : 4000,
      delta_pmdec_mas_yr: within ? -8 : 2500,
      sigma_combined_mas_yr: within ? 30 : 200,
      within_3_sigma: within,
    },
    sources,
  }
}
