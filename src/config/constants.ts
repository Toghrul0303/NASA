/**
 * Frontend presentation constants. FRONTEND_SPEC §16.
 * Grid scale, flags, radii, annulus, epoch gap, and the bad mask
 * are read from meta and are not defined here.
 */

/** Asinh softening `a`. Used by stretch, difference, RGB, and lambda-time. */
export const ASINH_SOFTENING = 0.1

/** Clip for the signed significance display. */
export const S_CLIP = 5

/** Significance contour level. */
export const SIGNIFICANCE_CONTOUR = 3

/** Alignment residual below this (px) is good. */
export const ALIGN_GOOD_PX = 0.3

/** Alignment residual below this (px) is caution; at or above it is poor. */
export const ALIGN_POOR_PX = 0.5

/** Feature-RGB on-coadd frame count below this shows the noisy caution. */
export const FEATURE_MIN_FRAMES = 3

/** LRU capacity for decoded planes. */
export const DECODE_CACHE_ITEMS = 64

/** Maximum streamed frames kept for the live preview strip. */
export const STREAM_PREVIEW_MAX = 48

/** Consecutive SSE failures before the client gives up. */
export const SSE_MAX_RECONNECTS = 8

/** Watchdog: abort the stream when no bytes arrive for this long. */
export const SSE_STALL_MS = 45000

/** Show the slow-job hint when `done` has not increased for this long. */
export const JOB_SLOW_MS = 60000

/** Debounce for map pan/zoom URL writes. */
export const URL_DEBOUNCE_MS = 250

/** Minimum epoch segment length, in days, on the compressed time axis. */
export const EPOCH_MIN_SPAN_DAYS = 1

/** Gap, in screen pixels, between epoch segments. */
export const EPOCH_GAP_PX = 24

/** Fixed screen-space width of a lambda-time cell. */
export const LT_CELL_WIDTH_PX = 6

/** Minimum screen-space height of a lambda-time cell. */
export const LT_MIN_CELL_PX = 3

/** Frame canvas zoom limits. */
export const ZOOM_MIN = 1
export const ZOOM_MAX = 32

/** Map field-of-view limits, degrees. */
export const FOV_MIN_DEG = 0.01
export const FOV_MAX_DEG = 180
