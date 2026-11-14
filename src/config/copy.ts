/**
 * User-facing strings. Quoted sentences are taken from FRONTEND_SPEC §§7, 13, 14, 15
 * and the dataset error keys named for this module in §6.1.
 */

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

/** Mandatory photometry labels. §13. */
export const photometry = {
  quickLook: 'Quick-look from L2 cutouts',
  notScienceGrade: 'Not science-grade photometry',
  dichroicGap: 'Dichroic gap (channels 50-51)',
} as const

/** Quoted Gaia-panel sentences besides the verdict headlines. §14. */
export const gaiaCopy = {
  epochAssumedJ2000: 'Epoch not supplied, assumed J2000',
  within3SigmaYes: 'Within 3 sigma: yes',
  within3SigmaNo: 'Within 3 sigma: no',
  notAvailable: 'n/a',
  none: 'none',
  rerunWithProperMotion: 'Re-run with proper motion',
} as const

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
