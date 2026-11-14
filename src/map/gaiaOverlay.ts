/**
 * Gaia markers and predicted track for the map. FRONTEND_SPEC §8.3.
 * Positions and the track are read from gaia.json. Nothing is recomputed.
 */
import { gaiaEpochLabel } from '../config/copy'
import type { Gaia } from '../contract/types'
import { verdictColor } from '../ui/verdictColor'
import type { GaiaMapSource, GaiaTrackPoint, MapAdapter } from './aladinAdapter'

export function gaiaMapSources(gaia: Gaia): GaiaMapSource[] {
  if (gaia.query_status !== 'ok') return []
  const primaryColor = verdictColor(gaia.verdict)
  return gaia.sources.map((source) => ({
    sourceId: source.source_id,
    raDeg: source.ra_deg,
    decDeg: source.dec_deg,
    refEpochYear: source.ref_epoch_year,
    isPrimary: source.is_primary,
    color: source.is_primary ? primaryColor : undefined,
    photGMeanMag: source.phot_g_mean_mag,
    parallaxMas: source.parallax_mas,
    pmraMasYr: source.pmra_mas_yr,
    pmdecMasYr: source.pmdec_mas_yr,
    separationArcsec: source.separation_arcsec,
  }))
}

/** Polyline vertices in `predicted_track` order. Null when there is no primary track. */
export function gaiaMapTrack(gaia: Gaia): GaiaTrackPoint[] | null {
  if (gaia.query_status !== 'ok') return null
  const primary = gaia.sources.find((source) => source.is_primary)
  const track = primary?.predicted_track
  if (!track || track.length === 0) return null
  return track.map((point) => ({
    raDeg: point.ra_deg,
    decDeg: point.dec_deg,
    label: gaiaEpochLabel(point.epoch_id),
  }))
}

/** Push the overlay, or clear it when the layer is off or the query did not succeed. */
export function syncGaiaOverlay(
  adapter: Pick<MapAdapter, 'setGaiaSources' | 'setGaiaTrack'>,
  gaia: Gaia | null,
  visible: boolean,
): void {
  if (!gaia || !visible || gaia.query_status !== 'ok') {
    adapter.setGaiaSources([])
    adapter.setGaiaTrack(null)
    return
  }
  adapter.setGaiaSources(gaiaMapSources(gaia))
  adapter.setGaiaTrack(gaiaMapTrack(gaia))
}
