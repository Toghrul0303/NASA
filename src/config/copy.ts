/**
 * User-facing strings. Quoted sentences are taken from FRONTEND_SPEC §§7, 13, 14, 15
 * and the dataset error keys named for this module in §6.1.
 */
import type { ContractErrorCode } from '../contract/validate'

/** Gaia verdict headlines. §14.1. The client never recomputes the verdict. */
export const verdictHeadlines = {
  match_consistent: 'Gaia match, motion consistent',
  match_inconsistent: 'Gaia match, motion inconsistent: possible blend or variability',
  no_counterpart: 'No Gaia counterpart',
  unavailable: 'Gaia query unavailable',
} as const

export type VerdictId = keyof typeof verdictHeadlines

/** Shown with `unavailable` in place of the sources table, measured motion, and overlay. */
export const verdictUnavailableExplanation = 'Gaia could not be queried; SPHEREx data are unaffected'

/** Info note under the verdict when the loaded slug matches. §14.1. */
export const slugNotes = {
  'eps-indi-b':
    'A close brown-dwarf pair: the components are blended at 6.15 arcsec per pixel. This is expected, not a tool failure.',
  'wise-0855': 'Extremely red and optically faint; an absent Gaia counterpart is plausible.',
} as const

export type SlugNoteId = keyof typeof slugNotes

export function slugNote(slug: string): string | undefined {
  if (slug === 'eps-indi-b' || slug === 'wise-0855') return slugNotes[slug]
  return undefined
}

/** Display names for `meta.processing.line_markers`. §13.2. `H⁻` uses U+207B. */
export const lineMarkerLabels = {
  'Pa-beta': 'Pa\u03B2',
  'H-minus': 'H\u207B',
  'Pa-alpha': 'Pa\u03B1',
  'Br-gamma': 'Br\u03B3',
  'Br-beta': 'Br\u03B2',
  'PAH-3.3': 'PAH 3.3',
  'Br-alpha': 'Br\u03B1',
  CO: 'CO',
} as const

export type LineMarkerId = keyof typeof lineMarkerLabels

function isLineMarkerId(name: string): name is LineMarkerId {
  return Object.prototype.hasOwnProperty.call(lineMarkerLabels, name)
}

/** Display name for a `line_markers` entry. Unknown names are returned unchanged. */
export function lineMarkerDisplayName(name: string): string {
  return isLineMarkerId(name) ? lineMarkerLabels[name] : name
}

/** Tooltip for one spectral line: display name and wavelength. */
export function lineMarkerHover(name: string, lambdaUm: string): string {
  return `${lineMarkerDisplayName(name)}, ${lambdaUm} µm`
}

/** Mandatory photometry labels. §13. */
export const photometry = {
  quickLook: 'Quick-look from L2 cutouts',
  notScienceGrade: 'Not science-grade photometry',
  dichroicGap: 'Dichroic gap (channels 50-51)',
} as const

/** SED and lambda-time chrome. §13. */
export const sedCopy = {
  toolLabel: 'SED and lambda-time',
  loading: 'Loading SED',
  openIrsa: 'Open in IRSA Spectrophotometry Tool',
  aperture: 'Aperture',
  hideFlagged: 'Hide flagged',
  detectors: 'Detectors',
  epochs: 'Epochs',
  noFrames: 'No frames',
  showOnlyEpoch: 'Show only this epoch',
  showAllEpochs: 'Show all epochs',
  viewLabel: 'Photometry view',
  viewSed: 'SED',
  viewLambdaTime: 'λ–time',
  logWavelength: 'Log wavelength',
  asinhFlux: 'Signed asinh flux',
  lineMarkers: 'Line markers',
  timeAxisLabel: 'Time axis',
  timeCompressed: 'Compressed',
  timeTrue: 'True time',
  downloadCsv: 'Download CSV',
  lightCurveNote: 'Only comparable within one detector and wavelength window',
  planeLabel:
    'Lambda-time plane. One cell per frame, coloured by aperture flux. Flagged cells have a dark outline. Points are not connected.',
  stripLabel: 'Light curve for the wavelength window. Marker colour and shape show the detector.',
  bandLabel: 'Wavelength window',
  colourBar: 'Flux colour scale, mJy',
  epochHeader: 'Show the SED for this epoch',
  plotLabel:
    'Spectral energy distribution. One marker per frame, coloured by epoch. Flagged markers are hollow. Points are not connected.',
  wavelengthAxis: 'Wavelength (µm)',
  fluxAxis: 'Flux (mJy)',
  noPoints: 'No photometry points for this selection.',
  flagged: 'flagged',
  notFlagged: 'not flagged',
  contaminationLevel: 'contamination level',
  solidAngleSapm: 'per-detector solid-angle pixel map',
} as const

export function apertureRadius(px: number): string {
  return `${px} px`
}

export function framesWithoutPhotometry(count: number): string {
  return `${count} frames without photometry`
}

export function solidAngleNominal(nominalPixelSr: number): string {
  return `nominal pixel solid angle ${nominalPixelSr} sr`
}

export function annulusLabel(innerPx: number, outerPx: number): string {
  return `Annulus ${innerPx}–${outerPx} px`
}

export function sedAtEpoch(epochId: number): string {
  return `SED at epoch ${epochId}`
}

/** Hover and live-region text for one SED point. Flux and wavelength are already formatted. */
export function sedPointHover(input: {
  obsTimeUtc: string
  epochId: number
  detector: number
  lambdaUm: string
  bandwidthUm: string
  fluxMjy: string
  fluxErrMjy: string
  contamination: string
  flagged: boolean
}): string {
  const flag = input.flagged ? sedCopy.flagged : sedCopy.notFlagged
  const flux = input.fluxErrMjy === '' ? `${input.fluxMjy} mJy` : `${input.fluxMjy} ± ${input.fluxErrMjy} mJy`
  return `${input.obsTimeUtc}, epoch ${input.epochId}, D${input.detector}, ${input.lambdaUm} µm, bandwidth ${input.bandwidthUm} µm, ${flux}, ${sedCopy.contaminationLevel} ${input.contamination}, ${flag}`
}

/** Quoted Gaia-panel sentences besides the verdict headlines. §14. */
export const gaiaCopy = {
  epochAssumedJ2000: 'Epoch not supplied, assumed J2000',
  within3SigmaYes: 'Within 3 sigma: yes',
  within3SigmaNo: 'Within 3 sigma: no',
  notAvailable: 'n/a',
  none: 'none',
  rerunWithProperMotion: 'Re-run with proper motion',
  /** Shown on the disabled control. The position form arrives in F15. */
  rerunDisabledTooltip: 'The position form is not available yet',
  /** Comparison has no plot because `measured_pm` is null. */
  measuredMotionMissing: 'Measured motion missing',
  /** Comparison has no plot because the primary source has no proper motion. */
  primaryHasNoProperMotion: 'The primary has no proper motion',
  loading: 'Loading Gaia check',
  targetMotion: 'Target proper motion',
  measuredMotion: 'Measured motion',
  comparison: 'Comparison',
  sources: 'Sources',
  queryDetails: 'Query details',
  matchRadius: 'Match radius',
  sourcesInCone: 'Sources in cone',
  primary: 'Primary',
  copy: 'Copy',
  sourceId: 'source_id',
  photGMeanMag: 'phot_g_mean_mag',
  parallaxMas: 'parallax_mas',
  pmraMasYr: 'pmra_mas_yr',
  pmdecMasYr: 'pmdec_mas_yr',
  separationArcsec: 'separation_arcsec',
  pmSource: 'pm_source',
  pmReference: 'pm_reference',
  framesUsed: 'n_frames_used',
  epochsUsed: 'n_epochs_used',
  baselineDays: 'baseline_days',
  method: 'method',
  deltaPmra: 'delta_pmra',
  deltaPmdec: 'delta_pmdec',
  sigmaCombined: 'sigma_combined_mas_yr',
  executedUtc: 'executed_utc',
  radiusArcsec: 'radius_arcsec',
  table: 'table',
  endpoint: 'endpoint',
  adql: 'ADQL',
  plusMinus: '+-',
  arcsec: 'arcsec',
  gaiaPoint: 'Gaia',
  measuredPoint: 'Measured',
  differenceVector: 'Difference',
  pmraAxis: 'pmra',
  pmdecAxis: 'pmdec',
  comparisonPlotLabel: 'Proper motion comparison of Gaia and the measured motion',
  openGaiaCheck: 'Open Gaia check',
  centreOnSource: 'Centre map and canvas on this source',
  predictedMarker: 'Gaia (predicted)',
} as const

/** Predicted-track point label. §8.3. `epoch_id` is the delivered track entry. */
export function gaiaEpochLabel(epochId: number): string {
  return `epoch ${epochId}`
}

/**
 * Null measured-motion sentence. The numbers are read from
 * `meta.processing.pm_fit_min_epochs` and `pm_fit_min_baseline_days`.
 * Defaults in the spec sentence are 3 epochs and 300 days.
 */
export function measuredMotionUnavailable(minEpochs: number, minBaselineDays: number): string {
  return `Not enough epochs or baseline for a motion fit (needs at least ${minEpochs} epochs over ${minBaselineDays} days)`
}

/** Job and stream failures. §7.2, §7.6. */
export const jobErrors = {
  not_found: 'Job not found or expired',
  connection_lost: 'Connection lost',
  no_coverage: 'No SPHEREx exposures overlap this position in the configured releases.',
  upstream_unavailable: 'The upstream archive is unavailable.',
  timeout: 'The job timed out.',
  internal_error: 'The job failed with an internal error.',
} as const

export type JobErrorCode = keyof typeof jobErrors

/** One-time warning and info chips. §7.6. */
export const jobWarnings = {
  wavelength_gradient:
    'Wavelength varies across the cutout more than one bandwidth; per-frame lambda is evaluated at the target position.',
  gaia_unavailable: verdictUnavailableExplanation,
  frame_dropped: 'A streamed frame was dropped because its pixels did not match the expected format.',
} as const

export const jobStatus = {
  joinedExisting: 'Joined an existing job',
  resume: 'Resume',
} as const

/** Analyze-position panel. Preset warning text matches TIER2_PRESETS.md. */
export const tier2Copy = {
  title: 'Analyze this position',
  ra: 'Right ascension',
  dec: 'Declination',
  size: 'Size',
  run: 'Run',
  retry: 'Retry',
  close: 'Close',
  presets: 'Presets',
  defaultPreset: 'Default',
  mayFail: 'may fail while IRSA is unstable',
  submitting: 'Submitting',
  queued: 'Queued',
  running: 'Running',
  complete: 'Complete',
  failedPlain: 'This analysis failed.',
  code: 'Code',
  message: 'Message',
  partialDetail: 'Some frames were dropped. The result is marked partial.',
  invalidSize: 'Submit size 0.3',
  mockOutcome: 'Mock outcome',
  mockAutomatic: 'Automatic',
  mockCached: 'Cached hit',
  mockProgress: 'New job',
  mockPartial: 'Partial result',
  mockFailed: 'Failed job',
  mockInvalid: 'Invalid body',
  datasetSlug: 'Dataset',
  liveComingSoon: 'Live analysis is coming soon. Try the preset.',
} as const

/** About page glossary. Plain-language terms for first-time visitors. */
export const aboutGlossaryCopy = {
  eyebrow: 'Glossary',
  title: 'Words you will meet',
  label: 'Glossary of terms',
} as const

export interface AboutGlossaryEntry {
  id: string
  term: string
  definition: string
}

export const aboutGlossary: readonly AboutGlossaryEntry[] = [
  {
    id: 'spherex',
    term: 'SPHEREx',
    definition: 'NASA all-sky infrared survey telescope that maps the sky in 102 colours (0.75 to 5 micrometres).',
  },
  {
    id: 'infrared',
    term: 'Infrared',
    definition: 'Light redder than our eyes see; it passes through dust and shows cool objects.',
  },
  {
    id: 'wavelength',
    term: 'Wavelength (µm)',
    definition: 'The colour of light; 1 µm is one millionth of a metre.',
  },
  {
    id: 'pixel',
    term: 'Pixel (6.15 arcsec)',
    definition: 'The smallest image square; close stars can blend inside one pixel.',
  },
  {
    id: 'arcsecond',
    term: 'Arcsecond',
    definition: 'A tiny angle; 3600 arcseconds make one degree, and the Moon is about 1800 arcseconds wide.',
  },
  {
    id: 'ra-dec',
    term: 'RA / Dec',
    definition: 'Sky coordinates, like longitude and latitude.',
  },
  {
    id: 'epoch',
    term: 'Epoch',
    definition: 'A group of observations taken close in time; SPHEREx revisits a spot about every 6 months.',
  },
  {
    id: 'blink',
    term: 'Blink',
    definition: 'Showing images from different times in turn; fixed stars stay still, movers jump.',
  },
  {
    id: 'proper-motion',
    term: 'Proper motion',
    definition: 'A star’s yearly shift on the sky, in milliarcseconds per year (1 arcsecond = 1000 mas).',
  },
  {
    id: 'sed',
    term: 'SED',
    definition: 'Spectral energy distribution, an object’s brightness at each colour.',
  },
  {
    id: 'lambda-time',
    term: 'Lambda-time plane',
    definition: 'Brightness by colour and time in one chart.',
  },
  {
    id: 'sigma',
    term: 'Sigma',
    definition: 'Measurement uncertainty; 3 sigma means very unlikely to be chance (about 0.3 percent).',
  },
  {
    id: 'difference-image',
    term: 'Difference image',
    definition:
      'One image minus another; fixed sources cancel and changes remain, and a mover looks like a plus and minus pair.',
  },
  {
    id: 'false-colour',
    term: 'False-colour RGB',
    definition: 'Infrared colours shown as red, green and blue; the colours are assigned, not real.',
  },
  {
    id: 'gaia',
    term: 'Gaia',
    definition: 'ESA catalogue of positions and motions of over a billion stars, used as a cross-check.',
  },
  {
    id: 'dichroic-gap',
    term: 'Dichroic gap',
    definition: 'A small gap in SPHEREx coverage near 2.4 µm (channels 50 and 51).',
  },
  {
    id: 'zodiacal-light',
    term: 'Zodiacal light',
    definition: 'Sunlight scattered by dust in the solar system; a background that is subtracted.',
  },
  {
    id: 'brown-dwarf',
    term: 'Brown dwarf',
    definition: 'Heavier than a planet but too light to be a star; cold and bright in infrared.',
  },
]

/** Community concept preview. Nothing on that page is saved or shared. */
export const communityCopy = {
  navLabel: 'Community',
  eyebrow: 'Community',
  title: 'Analyses, shared',
  banner: 'Concept preview, not live. Nothing here is saved or shared.',
  intro: 'A look at how shared analyses could appear. Each card opens a real Tier 1 view in the Lab.',
  tool: 'Tool',
  target: 'Target',
  openAnalysis: 'Open analysis',
  comment: 'Comment',
  fork: 'Fork',
  reproduce: 'Reproduce',
  comingLater: 'Coming later',
  roadmapTitle: 'Roadmap',
  roadmapLabel: 'Roadmap steps',
} as const

export const roadmapSteps = [
  { id: 'share', title: 'Share', detail: 'Copy a link or embed code for any view.', status: 'Live now', live: true },
  { id: 'notebook', title: 'Notebook', detail: 'Keep notes next to an analysis.', status: 'Coming later', live: false },
  { id: 'community', title: 'Community', detail: 'Publish, comment and fork.', status: 'Coming later', live: false },
] as const

/** Lab header share buttons. FRONTEND_SPEC §5.4. */
export const shareCopy = {
  copyLink: 'Copy link',
  copyEmbed: 'Copy embed code',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  iframeTitle: 'ExoTrace SPHEREx Lab',
} as const

export function tier2SizeLabel(sizeDeg: number): string {
  return `${sizeDeg} deg`
}

export function tier2FieldIssue(field: string, issue: string): string {
  return `${field}: ${issue}`
}

export function queuePosition(position: number): string {
  return `Position ${position}`
}

export function progressFrames(done: number, total: number): string {
  return `${done}/${total} frames`
}

/**
 * HTTP failures that show a toast and an inline error and are not retried. §7.1.
 * `invalid_request` matches the error envelope example in DATA_CONTRACT §11.5;
 * field issues from `error.details` are shown on the controls.
 */
export const requestErrors = {
  malformed_json: 'The request could not be read.',
  unsupported_media_type: 'Send the request as JSON.',
  invalid_request: 'Request validation failed.',
  queue_full: 'The job queue is full.',
  internal_error: 'The server could not complete this request.',
} as const

/** Dataset load failures. Keys named in §6.1. */
export const datasetErrors = {
  integrity_failed: 'Dataset integrity check failed.',
  not_found: 'Dataset not found.',
  unsupported_version: 'unsupported data version',
} as const

export type DatasetErrorCode = keyof typeof datasetErrors

/**
 * Sentences shown for a failed static load. The key is the `ContractError` code.
 * `invalid` covers a malformed document or an HTTP failure other than a missing dataset.
 */
export const loadErrors = {
  not_found: 'This dataset does not exist.',
  integrity_failed: 'The dataset failed an integrity check and was not loaded.',
  unsupported_version: 'Unsupported data version.',
  invalid: 'The dataset is invalid and was not loaded.',
} as const satisfies Record<ContractErrorCode, string>

/** User-facing sentence for a `ContractError` code. */
export function datasetErrorMessage(code: ContractErrorCode): string {
  return loadErrors[code]
}

/** Partial-dataset banner. §6.1, referenced from §15.2. */
export function framesNotFetched(count: number): string {
  return `${count} frames could not be fetched`
}

/** Example empty state from §15.2. */
export function noFramesInWindow(detector: number): string {
  return `No frames for detector D${detector} in this window`
}

/** Offline toast and the recovery card. §15.2, §15.6. */
export const recovery = {
  offline: 'You are offline',
  reload: 'Reload',
  goToTier1Targets: 'Go to Tier 1 targets',
} as const

/** Bad flag names from DATA_CONTRACT §3.4. SOURCE (bit 21) is benign and is omitted. */
export const BAD_FLAG_NAMES = [
  'TRANSIENT',
  'OVERFLOW',
  'SUR_ERROR',
  'PHANTOM',
  'REFERENCE',
  'NONFUNC',
  'DICHROIC',
  'MISSING_DATA',
  'HOT',
  'COLD',
  'FULLSAMPLE',
  'PHANMISS',
  'NONLINEAR',
  'PERSIST',
  'OUTLIER',
] as const

export interface GlossaryEntry {
  id: string
  term: string
  definition: string
  /** Present when the entry links to the bad-flag names of DC §3.4. */
  flagNames?: readonly string[]
}

/** Glossary popover. §15.2. */
export const glossary: readonly GlossaryEntry[] = [
  {
    id: 'lvf',
    term: 'LVF',
    definition:
      'Linear variable filter. Wavelength changes across the detector, so a frame’s wavelength is the value at the target position rather than one wavelength for the whole cutout.',
  },
  {
    id: 'epoch',
    term: 'Epoch',
    definition:
      'A group of frames close together in time. Frames are ordered by MJD, and a new epoch starts when the gap to the previous frame exceeds the epoch gap. Epoch ids run 0, 1, 2, … in time order.',
  },
  {
    id: 'detector-band',
    term: 'Detector and band',
    definition: 'A detector is an integer from 1 to 6. The SPHEREx band number equals the detector number.',
  },
  {
    id: 'channel',
    term: 'Channel',
    definition:
      'An integer from 0 to 101. Channel = 17 * (band - 1) + (band channel - 1). Channels 50 and 51 are the dichroic channels.',
  },
  {
    id: 'contamination',
    term: 'Contamination level',
    definition:
      '0 when no bad flags fall in the aperture, 1 when some do, and 2 when the aperture is empty or the worst flag fraction reaches the severe threshold. Colour is always paired with a tick shape.',
    flagNames: BAD_FLAG_NAMES,
  },
  {
    id: 'flags',
    term: 'Flags',
    definition:
      'Pixel quality bits. A pixel is unusable when any bad flag is set (flags & 712439). SOURCE (bit 21) is benign and is not part of that mask.',
    flagNames: BAD_FLAG_NAMES,
  },
  {
    id: 'dichroic',
    term: 'Dichroic',
    definition:
      'The gap at channels 50 and 51 between the two linear-variable-filter ranges. It is drawn as a hatched band and is never bridged.',
  },
  {
    id: 'mjy-sr',
    term: 'MJy/sr',
    definition:
      'Megajansky per steradian, the unit of image intensity and of its uncertainty. Intensities are shown in this unit and are not rescaled before display.',
  },
  {
    id: 'mjy',
    term: 'mJy',
    definition: 'Millijansky, the unit of aperture photometry on the SED. 1 MJy = 1e9 mJy.',
  },
  {
    id: 'asinh',
    term: 'Asinh stretch',
    definition:
      'A brightness stretch that keeps faint detail while compressing bright pixels. After percentile scaling, s = asinh(t / a) / asinh(1 / a), with softening a = 0.1.',
  },
]

/** Map chrome. §8.2, §8.3, §8.4. Cube failures stay off this list: they are logged, not shown. */
export const mapCopy = {
  mapLabel: 'All-sky map',
  coordinateFormLabel: 'Sky coordinates',
  ra: 'Right ascension (degrees)',
  dec: 'Declination (degrees)',
  fov: 'Field of view (degrees)',
  target: 'Target',
  targetPlaceholder: 'Choose a target',
  apply: 'Apply',
  invalidCoordinates: 'Enter a right ascension, declination, and field of view.',
  cubeToggle: 'SPHEREx cube',
  channelSlider: 'Cube channel',
  dichroicChannel: 'Dichroic channel, no data',
  cubeDisclosure: 'Mosaic, visualization only, no time axis; striping near Pa-alpha, 3.3 um PAH and Br-alpha.',
  copySourceId: 'Copy',
  gaiaLayer: 'Gaia',
} as const

/** Marker label. §8.3. The year is Gaia `ref_epoch_year`. */
export function gaiaPositionAtEpoch(year: number): string {
  return `Gaia position at epoch ${year}`
}

/** Band / channel readout. Channel index follows DC §3.3. */
export function cubeBandReadout(band: number, bandChannel: number): string {
  return `Band ${band}, channel ${bandChannel}`
}

/**
 * Wavelength label beside the cube slider. §8.4.
 * Bandwidth is omitted when `bandwidthUm` is null. Before a dataset is loaded the label is omitted entirely.
 */
export function cubeWavelengthLabel(lambdaUm: number, bandwidthUm: number | null): string {
  if (bandwidthUm == null) return `${lambdaUm} µm`
  return `${lambdaUm} µm · bandwidth ${bandwidthUm} µm`
}

/** False-colour RGB. FRONTEND_SPEC §12. Feature and Custom stay disabled until F14. */
export const rgbCopy = {
  loading: 'Loading false-colour RGB',
  presets: 'RGB preset',
  detector: 'Detector',
  equalChannel: 'Equal-channel',
  feature: 'Feature',
  custom: 'Custom',
  comingLater: 'Coming later',
  needsDetectors: 'Needs at least 3 detectors with data',
  serverPreview: 'Server preview',
  compositorUnavailable: 'Client compositor unavailable',
  noSlotData: 'No data for this slot',
  motionSmear: 'Motion smears in multi-epoch coadds',
  limits: 'Stretch limits',
  perChannel: 'Per-channel',
  linked: 'Linked',
  gainRed: 'Red gain',
  gainGreen: 'Green gain',
  gainBlue: 'Blue gain',
  slotRed: 'R',
  slotGreen: 'G',
  slotBlue: 'B',
  blueSlot: 'Blue',
  greenSlot: 'Green',
  redSlot: 'Red',
  intensityUnit: 'MJy/sr',
  masked: 'masked',
  ariaLabel: 'False-colour RGB, north up, east left.',
} as const

/** Detector-group composition, blue first (lowest wavelength). */
export function rgbGroupLine(blue: readonly number[], green: readonly number[], red: readonly number[]): string {
  const names = (detectors: readonly number[]) => detectors.map((detector) => `D${detector}`).join(' ')
  return `B: ${names(blue)}, G: ${names(green)}, R: ${names(red)}`
}

/** Per-group SNR and the minimum that selected the partition. */
export function rgbGroupSnr(blue: string, green: string, red: string, min: string): string {
  return `Group SNR B ${blue}, G ${green}, R ${red}; min ${min}`
}

/** Difference imaging. FRONTEND_SPEC §11. A difference map is never described as a detection. */
export const diffCopy = {
  loading: 'Loading difference imaging',
  modeLabel: 'Difference mode',
  layerLabel: 'Difference layer',
  layerS: 'Significance S',
  layerD: 'Difference D',
  operandA: 'Operand A',
  operandB: 'Operand B',
  framesGroup: 'Frames',
  coaddsGroup: 'Coadds',
  contours: 'Contours at ±3',
  noOperand: 'Choose an operand',
  needsTwoFrames: 'Needs two frames',
  identical: 'A and B are the same image, so the difference is empty',
  noPair: 'No valid pair for this mode. Pick A and B by hand.',
  spectralNote: 'Different wavelengths: stars differ in brightness, not only position.',
  staticSkyNote: 'static-sky only, motion smears',
  legendDipole: 'A mover appears as a positive/negative pair',
  caveat:
    'This map shows where two images differ. It does not show by itself that a source is real or that anything moved.',
  contourKey: 'Solid: S = +3. Dashed: S = -3.',
  alignmentLabel: 'Alignment',
  alignmentUnknown: 'Alignment unknown',
  alignmentWarning: 'Misalignment can create false dipoles',
  alignmentArtefact: 'Dipoles near bright stars may be alignment artefacts.',
  rowD: 'D',
  rowSigmaD: 'sD',
  rowS: 'S',
  rowDUnit: 'MJy/sr',
  masked: 'masked',
  pixelsAtLeast3: 'Pixels with |S| = 3',
  maxNearA: 'Max |S| within 3 px of A',
  ariaLabel: 'Difference image, north up, east left. Blue is negative and orange is positive.',
  minus: 'minus',
  allEpochs: 'all epochs',
  allDetectors: 'all detectors',
  markerA: 'A',
  markerB: 'B',
} as const

export const diffIssues = {
  mixed_kinds: 'A and B must both be frames or both be coadds',
  detector: 'A and B must use the same detector',
  epoch: 'A and B must come from different epochs',
  wavelength_match: 'Temporal frames need matched wavelengths (within one bandwidth)',
  wavelength_differ:
    'Spectral operands need clearly different wavelengths (more than one bandwidth apart, or coadd ranges that barely overlap)',
  scope: 'Coadd operands have the wrong scope for this mode',
  same_epoch: 'Spectral operands must share an epoch',
} as const

export function diffAlignmentBadge(state: 'good' | 'caution' | 'poor', px: string, arcsec: string): string {
  const word = state === 'good' ? 'good' : state === 'caution' ? 'caution' : 'poor'
  return `Alignment ${word}: ${px} px (${arcsec} arcsec)`
}

export function diffPeakSummary(count: number, maxNearA: string): string {
  return `${diffCopy.pixelsAtLeast3}: ${count}. ${diffCopy.maxNearA}: ${maxNearA}`
}
