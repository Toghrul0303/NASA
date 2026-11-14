import { describe, expect, it } from 'vitest'
import { EPOCH_GAP_PX, EPOCH_MIN_SPAN_DAYS } from '../../src/config/constants'
import type { ChannelRow, Epoch, Sed, SedPoint } from '../../src/contract/types'
import { buildCompressedAxis, countWithoutPhotometry, dichroicBand, toCsv } from '../../src/core/sed'

function channel(id: number, lambdaUm: number, bandwidthUm: number | null): ChannelRow {
  return {
    channel: id,
    band: 1,
    band_channel: 1,
    lambda_um: lambdaUm,
    bandwidth_um: bandwidthUm,
  }
}

function epoch(id: number, start: number, end: number): Epoch {
  return {
    epoch_id: id,
    mjd_start: start,
    mjd_end: end,
    mjd_mean: (start + end) / 2,
    n_frames: 1,
    detectors: [1],
  }
}

function point(overrides: Partial<SedPoint>): SedPoint {
  return {
    frame_index: 0,
    epoch_id: 1,
    detector: 2,
    channel: 3,
    mjd: 60000,
    obs_time_utc: '2024-01-01T00:00:00.000Z',
    lambda_um: 1.5,
    bandwidth_um: 0.1,
    flux_mjy: [1.25, null, 3],
    flux_err_mjy: [0.2, null, 0.4],
    flagged: false,
    centroid_x: null,
    centroid_y: null,
    centroid_err_px: null,
    ...overrides,
  }
}

describe('dichroicBand', () => {
  it('uses the midpoint to the adjacent channel when bandwidth_um is null', () => {
    const band = dichroicBand([
      channel(49, 4, 0.2),
      channel(50, 4.4, null),
      channel(51, 4.8, 0.2),
      channel(52, 5.2, 0.2),
    ])
    expect(band).not.toBeNull()
    expect(band?.startUm).toBeCloseTo(4.2)
    expect(band?.endUm).toBeCloseTo(4.9)
  })
})

describe('buildCompressedAxis', () => {
  it('orders segments, keeps fixed gaps, gives a zero-span epoch the minimum span, and maps MJD monotonically', () => {
    const axis = buildCompressedAxis(
      [epoch(2, 60200, 60205), epoch(0, 60000, 60010), epoch(1, 60100, 60100)],
      324,
      EPOCH_MIN_SPAN_DAYS,
      EPOCH_GAP_PX,
    )
    expect(axis.segments.map((segment) => segment.epochId)).toEqual([0, 1, 2])
    const zero = axis.segments[1]
    expect(zero?.spanDays).toBe(EPOCH_MIN_SPAN_DAYS)
    const first = axis.segments[0]
    const second = axis.segments[1]
    const third = axis.segments[2]
    expect(first && second ? second.x0 - first.x1 : Number.NaN).toBeCloseTo(EPOCH_GAP_PX)
    expect(second && third ? third.x0 - second.x1 : Number.NaN).toBeCloseTo(EPOCH_GAP_PX)
    const scaleA = first ? (first.x1 - first.x0) / first.spanDays : Number.NaN
    const scaleB = second ? (second.x1 - second.x0) / second.spanDays : Number.NaN
    expect(scaleA).toBeCloseTo(scaleB)

    const start = axis.mjdToX(0, 60000)
    const mid = axis.mjdToX(0, 60005)
    const end = axis.mjdToX(0, 60010)
    expect(start).toBeLessThan(mid)
    expect(mid).toBeLessThan(end)
    expect(axis.mjdToX(1, 60100)).toBeLessThan(axis.mjdToX(1, 60100.5))
  })
})

describe('countWithoutPhotometry', () => {
  it('counts points whose selected aperture flux is null', () => {
    const sed = {
      points: [
        point({ flux_mjy: [1, null, 2], flux_err_mjy: [0.1, null, 0.2] }),
        point({ frame_index: 1, flux_mjy: [null, null, 3], flux_err_mjy: [null, null, 0.3] }),
        point({ frame_index: 2, flux_mjy: [4, 5, null], flux_err_mjy: [0.4, 0.5, null] }),
      ],
    } as Sed
    expect(countWithoutPhotometry(sed, 0)).toBe(1)
    expect(countWithoutPhotometry(sed, 1)).toBe(2)
    expect(countWithoutPhotometry(sed, 2)).toBe(1)
  })
})

describe('toCsv', () => {
  it('writes the aperture header, leaves nulls empty, and quotes a field that contains a comma', () => {
    const csv = toCsv(
      [
        point({
          flux_mjy: [null, null, null],
          flux_err_mjy: [null, null, null],
        }),
        point({
          frame_index: 4,
          obs_time_utc: '2024-01-02T00:00:00.000Z, extra',
          flux_mjy: [2, 2, 2],
          flux_err_mjy: [0.1, 0.1, 0.1],
        }),
      ],
      0,
    )
    const lines = csv.split('\n')
    expect(lines[0]).toBe(
      'frame_index,epoch_id,detector,channel,mjd,obs_time_utc,lambda_um,bandwidth_um,flux_mjy,flux_err_mjy,flagged',
    )
    expect(lines[1]).toBe('0,1,2,3,60000,2024-01-01T00:00:00.000Z,1.5,0.1,,,false')
    expect(lines[2]).toContain('"2024-01-02T00:00:00.000Z, extra"')
    expect(lines[2]).toContain(',2,0.1,false')
  })
})
