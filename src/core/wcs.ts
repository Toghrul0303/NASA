/**
 * TAN world/pixel conversion and proper-motion propagation.
 * DATA_CONTRACT §3.1, §3.2. FRONTEND_SPEC §9.2, §9.3.
 * Angles are degrees at the boundary and radians inside the trig.
 */
import type { Grid as MetaGrid } from '../contract/types'

/** Fields of `meta.grid` used by the TAN projection. */
export type Grid = Pick<
  MetaGrid,
  'crval1_deg' | 'crval2_deg' | 'crpix1' | 'crpix2' | 'cdelt1_deg' | 'cdelt2_deg' | 'width' | 'height'
>

export interface Pixel {
  x: number
  y: number
}

export interface World {
  ra: number
  dec: number
}

export interface OverlayPoint {
  u: number
  v: number
}

/** Proper motion is mas/yr. A null component contributes no motion. */
export interface MotionSource {
  ra0: number
  dec0: number
  pmra: number | null
  pmdec: number | null
  refYear: number
}

const DEG = Math.PI / 180
const MAS_PER_DEG = 3.6e6

/** Wrap right ascension into `[0, 360)`. */
function wrapRa(ra: number): number {
  const wrapped = ((ra % 360) + 360) % 360
  return wrapped === 0 ? 0 : wrapped
}

/**
 * World to pixel. DC §3.2.
 * Returns null when `D <= 0` (the point is behind the tangent plane).
 */
export function worldToPixel(ra: number, dec: number, grid: Grid): Pixel | null {
  const raC = grid.crval1_deg * DEG
  const decC = grid.crval2_deg * DEG
  const raR = ra * DEG
  const decR = dec * DEG
  const dRa = raR - raC
  const sinDec = Math.sin(decR)
  const cosDec = Math.cos(decR)
  const sinDecC = Math.sin(decC)
  const cosDecC = Math.cos(decC)
  const cosDRa = Math.cos(dRa)
  const D = sinDecC * sinDec + cosDecC * cosDec * cosDRa
  if (!(D > 0)) return null
  const xi = ((cosDec * Math.sin(dRa)) / D) * (180 / Math.PI)
  const eta = ((cosDecC * sinDec - sinDecC * cosDec * cosDRa) / D) * (180 / Math.PI)
  return {
    x: grid.crpix1 - 1 + xi / grid.cdelt1_deg,
    y: grid.crpix2 - 1 + eta / grid.cdelt2_deg,
  }
}

/**
 * Inverse TAN deprojection. FRONTEND_SPEC §9.3.
 * `rho == 0` returns the grid centre. Right ascension is wrapped into `[0, 360)`.
 */
export function pixelToWorld(x: number, y: number, grid: Grid): World {
  const xi = (x - (grid.crpix1 - 1)) * grid.cdelt1_deg * DEG
  const eta = (y - (grid.crpix2 - 1)) * grid.cdelt2_deg * DEG
  const rho = Math.hypot(xi, eta)
  if (rho === 0) {
    return { ra: wrapRa(grid.crval1_deg), dec: grid.crval2_deg }
  }
  const raC = grid.crval1_deg * DEG
  const decC = grid.crval2_deg * DEG
  const c = Math.atan(rho)
  const sinC = Math.sin(c)
  const cosC = Math.cos(c)
  const sinDecC = Math.sin(decC)
  const cosDecC = Math.cos(decC)
  const sinDec = cosC * sinDecC + (eta * sinC * cosDecC) / rho
  const dec = Math.asin(Math.min(1, Math.max(-1, sinDec)))
  const ra = raC + Math.atan2(xi * sinC, rho * cosDecC * cosC - eta * sinDecC * sinC)
  return { ra: wrapRa(ra / DEG), dec: dec / DEG }
}

/** Julian year of an MJD. DC §3.1. */
export function yearOfMjd(mjd: number): number {
  return 2000 + (mjd - 51544.5) / 365.25
}

/**
 * Propagate a source to `mjd`. FRONTEND_SPEC §9.3, DC §3.1.
 * A null proper motion is zero for that component, so both null is the identity.
 */
export function propagate(source: MotionSource, mjd: number): World {
  const pmra = source.pmra ?? 0
  const pmdec = source.pmdec ?? 0
  if (pmra === 0 && pmdec === 0) {
    return { ra: source.ra0, dec: source.dec0 }
  }
  const dt = yearOfMjd(mjd) - source.refYear
  const cosDec = Math.cos(source.dec0 * DEG)
  const ra = source.ra0 + (pmra / MAS_PER_DEG) * dt / cosDec
  const dec = source.dec0 + (pmdec / MAS_PER_DEG) * dt
  return { ra, dec }
}

/** Continuous grid position to overlay pixel space. FRONTEND_SPEC §9.2. */
export function gridToOverlay(x: number, y: number, H: number): OverlayPoint {
  return { u: x + 0.5, v: H - 0.5 - y }
}
