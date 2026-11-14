// Derived from DATA_CONTRACT.md 1.0.0, read-only
// schema_version is string: a consumer accepts any 1.x.y. Major is checked at runtime.

/** Integer channel index 0–101. */
export type Channel = number

export type Release = 'dr1' | 'qr3'

export type Detector = 1 | 2 | 3 | 4 | 5 | 6

export type SizeDeg = 0.05 | 0.1 | 0.2

export type Tier = 'tier1' | 'tier1_5' | 'tier2'

export type DatasetStatus = 'complete' | 'partial'

export type PmSource = 'gaia_dr3' | 'literature' | 'user' | 'none'

export type FlagName =
  | 'TRANSIENT'
  | 'OVERFLOW'
  | 'SUR_ERROR'
  | 'PHANTOM'
  | 'REFERENCE'
  | 'NONFUNC'
  | 'DICHROIC'
  | 'MISSING_DATA'
  | 'HOT'
  | 'COLD'
  | 'FULLSAMPLE'
  | 'PHANMISS'
  | 'NONLINEAR'
  | 'PERSIST'
  | 'OUTLIER'

export type FlagFractions = Record<FlagName, number>

export type TripleNullableNumber = [number | null, number | null, number | null]

export interface FileEntry {
  bytes: number
  sha256: string
}

export interface DatasetFiles {
  'frames.json': FileEntry
  'frames.bin': FileEntry
  'coadds.json': FileEntry
  'coadds.bin': FileEntry
  'sed.json': FileEntry
  'gaia.json': FileEntry
}

export interface BinaryDescriptor {
  file: 'frames.bin' | 'coadds.bin'
  dtype: 'float16'
  byte_order: 'little'
  axes: ['item', 'plane', 'y', 'x']
  planes: ['intensity', 'sigma']
  unit: 'MJy/sr'
  n_items: number
  height: number
  width: number
  bytes: number
}

export interface Target {
  name: string | null
  input_ra_deg: number
  input_dec_deg: number
  coord_epoch_year: number
  coord_epoch_assumed: boolean
  pmra_mas_yr: number | null
  pmdec_mas_yr: number | null
  parallax_mas: number | null
  pm_source: PmSource
  pm_reference: string | null
}

export interface Center {
  ra_deg: number
  dec_deg: number
  t_mid_mjd: number
}

export interface Observations {
  n_frames: number
  n_epochs: number
  mjd_min: number
  mjd_max: number
  releases: Release[]
  n_failed_fetches: number
  failed_source_uris: string[]
}

export interface Grid {
  size_deg: SizeDeg
  width: number
  height: number
  projection: 'TAN'
  pixel_scale_arcsec: 6.15
  crval1_deg: number
  crval2_deg: number
  crpix1: number
  crpix2: number
  cdelt1_deg: number
  cdelt2_deg: number
}

export interface LineMarker {
  name: string
  lambda_um: number
}

export interface Processing {
  bad_mask: 712439
  bad_flag_bits: Record<FlagName, number>
  benign_flag_bits: { SOURCE: 21 }
  photometry_radii_px: [3, 4, 5]
  annulus_px: [6, 10]
  background_model: 'zodi_subtracted_plus_local_sigma_clipped'
  reprojection: 'interp' | 'exact'
  epoch_gap_days: number
  contamination_severe_fraction: number
  pm_fit_min_epochs: 3
  pm_fit_min_baseline_days: 300
  line_markers: LineMarker[]
}

export interface ChannelRow {
  channel: Channel
  band: number
  band_channel: number
  lambda_um: number
  bandwidth_um: number | null
}

export interface PreviewStretch {
  type: 'asinh'
  lower_percentile: 1
  upper_percentile: 99.5
}

export interface Previews {
  thumb: 'previews/thumb.png'
  rgb_detector: 'previews/rgb_detector.png' | null
  rgb_equal_channel: 'previews/rgb_equal_channel.png'
  stretch: PreviewStretch
}

export interface Meta {
  schema_version: string
  slug: string
  tier: Tier
  title: string
  status: DatasetStatus
  created_utc: string
  data_version: string
  pipeline_version: string
  target: Target
  center: Center
  observations: Observations
  grid: Grid
  binaries: {
    frames: BinaryDescriptor
    coadds: BinaryDescriptor
  }
  processing: Processing
  channels: ChannelRow[]
  previews: Previews
  files: DatasetFiles
}

export interface Epoch {
  epoch_id: number
  mjd_start: number
  mjd_end: number
  mjd_mean: number
  n_frames: number
  detectors: Detector[]
}

export interface Frame {
  index: number
  frame_key: string
  obs_id: string
  release: Release
  processing_version: string | null
  detector: Detector
  mjd: number
  obs_time_utc: string
  epoch_id: number
  lambda_um: number
  bandwidth_um: number
  lambda_min_um: number
  lambda_max_um: number
  channel: Channel
  target_ra_deg: number
  target_dec_deg: number
  target_x: number
  target_y: number
  good_fraction: number
  aperture_pixels: number
  flag_fractions: FlagFractions | null
  contamination_level: 0 | 1 | 2
  saturated_pixels: number
  alignment_residual_px: number | null
  source_uri: string
}

export interface Frames {
  schema_version: string
  slug: string
  data_version: string
  n_frames: number
  epochs: Epoch[]
  frames: Frame[]
}

export type CoaddScope = 'epoch_detector' | 'detector' | 'channel'

export interface Coadd {
  index: number
  scope: CoaddScope
  epoch_id: number | null
  detector: Detector | null
  channel: Channel | null
  n_frames: number
  frame_indices: number[]
  mjd_min: number
  mjd_max: number
  mjd_mean: number
  lambda_mean_um: number
  lambda_min_um: number
  lambda_max_um: number
  snr_target: number | null
}

export interface DetectorRgb {
  blue: Detector[]
  green: Detector[]
  red: Detector[]
  group_snr: {
    blue: number
    green: number
    red: number
  }
  min_group_snr: number
}

export interface EqualChannelRgb {
  blue_channels: Channel[]
  green_channels: Channel[]
  red_channels: Channel[]
}

export interface FeatureLine {
  name: string
  lambda_um: number
  on_channel: Channel
  continuum_channels: Channel[]
}

export interface RgbPresets {
  detector_rgb: DetectorRgb | null
  equal_channel_rgb: EqualChannelRgb
  feature_lines: FeatureLine[]
}

export interface Coadds {
  schema_version: string
  slug: string
  data_version: string
  n_coadds: number
  coadds: Coadd[]
  rgb_presets: RgbPresets
}

export interface SedPoint {
  frame_index: number
  epoch_id: number
  detector: Detector
  channel: Channel
  mjd: number
  obs_time_utc: string
  lambda_um: number
  bandwidth_um: number
  flux_mjy: TripleNullableNumber
  flux_err_mjy: TripleNullableNumber
  flagged: boolean
  centroid_x: number | null
  centroid_y: number | null
  centroid_err_px: number | null
}

export interface Sed {
  schema_version: string
  slug: string
  data_version: string
  flux_unit: 'mJy'
  wavelength_unit: 'um'
  aperture_radii_px: [3, 4, 5]
  primary_aperture_index: 0
  annulus_px: [6, 10]
  solid_angle_source: 'sapm' | 'nominal_pixel'
  nominal_pixel_sr: 8.8897e-10
  n_points: number
  points: SedPoint[]
}

export interface PredictedTrackPoint {
  epoch_id: number
  mjd: number
  ra_deg: number
  dec_deg: number
  x: number
  y: number
}

export interface GaiaSource {
  /** Decimal Gaia source id, up to 19 digits. Never a number. */
  source_id: string
  ra_deg: number
  dec_deg: number
  ref_epoch_year: number
  pmra_mas_yr: number | null
  pmdec_mas_yr: number | null
  parallax_mas: number | null
  parallax_error_mas: number | null
  phot_g_mean_mag: number | null
  separation_arcsec: number
  is_primary: boolean
  predicted_track: PredictedTrackPoint[] | null
}

export interface MeasuredPm {
  pmra_mas_yr: number
  pmdec_mas_yr: number
  pmra_err_mas_yr: number
  pmdec_err_mas_yr: number
  n_frames_used: number
  n_epochs_used: number
  baseline_days: number
  method: 'weighted_linear_centroid'
}

export interface Consistency {
  delta_pmra_mas_yr: number
  delta_pmdec_mas_yr: number
  sigma_combined_mas_yr: number
  within_3_sigma: boolean
}

export interface GaiaQuery {
  endpoint: 'https://gea.esac.esa.int/tap-server/tap'
  table: 'gaiadr3.gaia_source'
  center_ra_deg: number
  center_dec_deg: number
  radius_arcsec: number
  executed_utc: string
  adql: string
}

export type GaiaVerdict = 'match_consistent' | 'match_inconsistent' | 'no_counterpart' | 'unavailable'

export interface Gaia {
  schema_version: string
  slug: string
  data_version: string
  query_status: 'ok' | 'unavailable'
  query: GaiaQuery
  match_radius_arcsec: 10
  n_sources_in_cone: number
  verdict: GaiaVerdict
  verdict_detail: string
  primary_source_id: string | null
  measured_pm: MeasuredPm | null
  consistency: Consistency | null
  sources: GaiaSource[]
}

export interface JobRequest {
  ra_deg: number
  dec_deg: number
  size_deg?: SizeDeg
  name?: string | null
  pmra_mas_yr?: number | null
  pmdec_mas_yr?: number | null
  coord_epoch_year?: number | null
  force_refresh?: boolean
}

export interface JobResponseRequest {
  ra_deg: number
  dec_deg: number
  size_deg: SizeDeg
  name: string | null
  pmra_mas_yr: number | null
  pmdec_mas_yr: number | null
  coord_epoch_year: number
  coord_epoch_assumed: boolean
  force_refresh: boolean
}

export type JobStatus = 'queued' | 'running' | 'complete'

export interface JobResponse {
  job_id: string
  slug: string
  status: JobStatus
  cached: boolean
  joined: boolean
  created_utc: string
  events_url: string
  data_base_url: string
  request: JobResponseRequest
}

export interface JobErrorDetail {
  field: string
  issue: string
}

export type JobErrorCode =
  | 'malformed_json'
  | 'unsupported_media_type'
  | 'invalid_request'
  | 'queue_full'
  | 'internal_error'
  | 'not_found'

export interface JobErrorResponse {
  error: {
    code: JobErrorCode
    message: string
    details: JobErrorDetail[]
  }
}

export interface JobStateEvent {
  job_id: string
  status: 'queued' | 'running' | 'complete' | 'failed'
  queue_position: number | null
  timestamp_utc: string
}

export interface StageEvent {
  job_id: string
  stage: 'discover' | 'fetch_process' | 'aggregate' | 'gaia' | 'export'
  state: 'started' | 'finished'
  elapsed_s: number
}

export interface DiscoveryEvent {
  job_id: string
  n_exposures_found: number
  n_exposures: number
  releases: { dr1: number; qr3: number }
  detectors: { '1': number; '2': number; '3': number; '4': number; '5': number; '6': number }
  tap_elapsed_s: number
}

export interface ProgressEvent {
  job_id: string
  stage: 'fetch_process'
  total: number
  done: number
  failed: number
  elapsed_s: number
}

export interface FrameEventPixels {
  encoding: 'base64'
  dtype: 'float16'
  byte_order: 'little'
  axes: ['plane', 'y', 'x']
  shape: [2, number, number]
  data: string
}

/** Streamed frame: the frames.json object without index and epoch_id. */
export interface FrameEvent {
  job_id: string
  seq_frame: number
  frame: Omit<Frame, 'index' | 'epoch_id'>
  pixels: FrameEventPixels
}

export type WarningEvent =
  | {
      job_id: string
      code: 'fetch_retry' | 'fetch_failed'
      message: string
      context: { source_uri: string; attempt: number }
    }
  | {
      job_id: string
      code: 'wavelength_gradient'
      message: string
      context: { max_span_um: number; min_bandwidth_um: number }
    }
  | {
      job_id: string
      code: 'gaia_unavailable'
      message: string
      context: null
    }

export interface CompleteFiles extends DatasetFiles {
  'meta.json': FileEntry
}

export interface CompleteEvent {
  job_id: string
  slug: string
  result_status: DatasetStatus
  data_base_url: string
  data_version: string
  n_frames: number
  n_epochs: number
  n_failed_fetches: number
  files: CompleteFiles
  elapsed_s: number
}

export interface FailedEvent {
  job_id: string
  code: 'no_coverage' | 'upstream_unavailable' | 'timeout' | 'internal_error'
  message: string
  retryable: boolean
  elapsed_s: number
}

export interface SsePayloads {
  job_state: JobStateEvent
  stage: StageEvent
  discovery: DiscoveryEvent
  progress: ProgressEvent
  frame: FrameEvent
  warning: WarningEvent
  complete: CompleteEvent
  failed: FailedEvent
}

export type SseEventName = keyof SsePayloads

export type SseEvent = {
  [K in SseEventName]: { id: number; event: K; data: SsePayloads[K] }
}[SseEventName]
