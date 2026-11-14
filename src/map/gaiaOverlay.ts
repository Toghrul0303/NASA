/**
 * Gaia markers and predicted track for the map. FRONTEND_SPEC §8.3.
 * Positions and the track are read from gaia.json. Nothing is recomputed.
 * Popup markup is consumed as HTML (`popupDesc` is assigned through innerHTML).
 */
import { gaiaCopy, gaiaEpochLabel, gaiaPositionAtEpoch, mapCopy } from '../config/copy'
import type { Gaia } from '../contract/types'
import { verdictColor } from '../ui/verdictColor'
import type { GaiaMapSource, GaiaTrackPoint, MapAdapter } from './aladinAdapter'

/** Gaia source ids are decimal strings of at most 19 digits (DC §1). */
const SOURCE_ID_PATTERN = /^[0-9]{1,19}$/

/** Finite numbers we format ourselves: digits, sign, decimal point, exponent. */
const FORMATTED_NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

/** Escape text before it is parsed as HTML. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** A finite number rendered by us, or null when the value cannot be shown raw. */
function formatPopupNumber(value: number): string | null {
  if (!Number.isFinite(value)) return null
  const text = String(value)
  return FORMATTED_NUMBER_PATTERN.test(text) ? text : null
}

/** Interpolate a formatted number. Every other string, including "n/a", is escaped. */
function popupNumber(value: number | null): string {
  if (value === null) return escapeHtml(gaiaCopy.notAvailable)
  return formatPopupNumber(value) ?? escapeHtml(gaiaCopy.notAvailable)
}

/**
 * A source id is interpolated raw only when it is 1–19 digits.
 * Anything else is escaped, including inside the copy-button attribute.
 */
function popupSourceId(sourceId: string): string {
  return SOURCE_ID_PATTERN.test(sourceId) ? sourceId : escapeHtml(sourceId)
}

/** Title plus HTML body for the map popup. The body is safe to assign as HTML. */
export function gaiaPopup(source: GaiaMapSource): { title: string; html: string } {
  const year = formatPopupNumber(source.refEpochYear)
  const title = year === null ? gaiaPositionAtEpoch(source.refEpochYear) : `Gaia position at epoch ${year}`
  const sourceId = popupSourceId(source.sourceId)
  const copyLabel = escapeHtml(mapCopy.copySourceId)
  const html = [
    `<p>${escapeHtml(title)}</p>`,
    `<p>${escapeHtml(gaiaCopy.sourceId)} ${sourceId} <button type="button" data-gaia-copy="${sourceId}">${copyLabel}</button></p>`,
    `<p>${escapeHtml(gaiaCopy.photGMeanMag)} ${popupNumber(source.photGMeanMag)}</p>`,
    `<p>${escapeHtml(gaiaCopy.parallaxMas)} ${popupNumber(source.parallaxMas)}</p>`,
    `<p>${escapeHtml('proper motion')} ${popupNumber(source.pmraMasYr)}, ${popupNumber(source.pmdecMasYr)}</p>`,
    `<p>${escapeHtml(gaiaCopy.separationArcsec)} ${popupNumber(source.separationArcsec)}</p>`,
  ].join('')
  return { title, html }
}

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
