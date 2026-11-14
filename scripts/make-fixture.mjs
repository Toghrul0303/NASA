/**
 * Deterministic synthetic /data/fixture-barnard dataset.
 * Node built-ins only. No Math.random and no clock reads.
 * Choices are listed in README-fixture.md.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'

const SLUG = 'fixture-barnard'
const SCHEMA_VERSION = '1.0.0'
const SIZE_DEG = 0.05
const PIXEL_SCALE = 6.15
const H = 2 * Math.ceil((SIZE_DEG * 3600) / (2 * PIXEL_SCALE))
const W = H
const CENTER_RA = 269.452
const CENTER_DEC = 4.693
const COORD_EPOCH = 2016
const PMRA = -803
const PMDEC = 10362
const EPOCH_GAP_DAYS = 30
const CONTAMINATION_SEVERE = 0.25
const FIXED_UTC = '2026-11-14T00:00:00.000Z'
const DEG = Math.PI / 180
const MAS_PER_DEG = 3.6e6
const APERTURE_PIXELS = 28

const FLAG_BITS = [
  ['TRANSIENT', 0],
  ['OVERFLOW', 1],
  ['SUR_ERROR', 2],
  ['PHANTOM', 4],
  ['REFERENCE', 5],
  ['NONFUNC', 6],
  ['DICHROIC', 7],
  ['MISSING_DATA', 9],
  ['HOT', 10],
  ['COLD', 11],
  ['FULLSAMPLE', 12],
  ['PHANMISS', 14],
  ['NONLINEAR', 15],
  ['PERSIST', 17],
  ['OUTLIER', 19],
]

const LINE_MARKERS = [
  { name: 'Pa-beta', lambda_um: 1.282 },
  { name: 'H-minus', lambda_um: 1.6 },
  { name: 'Pa-alpha', lambda_um: 1.875 },
  { name: 'Br-gamma', lambda_um: 2.166 },
  { name: 'Br-beta', lambda_um: 2.626 },
  { name: 'PAH-3.3', lambda_um: 3.3 },
  { name: 'Br-alpha', lambda_um: 4.052 },
  { name: 'CO', lambda_um: 4.67 },
]

const BAND_EDGES = [0.75, 1.11, 1.64, 2.42, 3.82, 4.42, 5]
const f32Scratch = new Float32Array(1)
const u32Scratch = new Uint32Array(f32Scratch.buffer)

function fail(message) {
  throw new Error(message)
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

function outputDir() {
  let path = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''))
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1)
  const dir = path.slice(0, path.lastIndexOf('/'))
  const parts = (dir + '/../public/data/fixture-barnard').split('/')
  const out = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  const resolved = out.join('/')
  if (!resolved.endsWith('public/data/fixture-barnard')) fail('unexpected output path ' + resolved)
  return resolved
}

function mulberry32(seed) {
  let state = seed >>> 0
  return function next() {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function roundRight(value, shift) {
  const remainder = value & ((1 << shift) - 1)
  const half = 1 << (shift - 1)
  let result = value >>> shift
  if (remainder > half || (remainder === half && (result & 1) === 1)) result += 1
  return result
}

function floatToHalf(value) {
  if (Number.isNaN(value)) return 0x7e00
  f32Scratch[0] = value
  const bits = u32Scratch[0]
  const sign = (bits >>> 16) & 0x8000
  const exp = (bits >>> 23) & 0xff
  const mant = bits & 0x7fffff
  if (exp === 0xff) return mant !== 0 ? 0x7e00 : sign | 0x7bff
  const unbiased = exp - 127
  if (exp === 0 || unbiased < -25) return sign
  if (unbiased > 15) return sign | 0x7bff
  if (unbiased < -14) {
    const sub = roundRight(mant | 0x800000, -unbiased - 1)
    if (sub >= 0x400) return sign | 0x0400
    return sign | sub
  }
  let halfMant = roundRight(mant, 13)
  let halfExp = unbiased + 15
  if (halfMant === 0x400) {
    halfMant = 0
    halfExp += 1
    if (halfExp >= 31) return sign | 0x7bff
  }
  return sign | (halfExp << 10) | halfMant
}

function halfToFloat(h) {
  const sign = h & 0x8000 ? -1 : 1
  const exp = (h >> 10) & 0x1f
  const mant = h & 0x03ff
  if (exp === 0) return sign * 2 ** -14 * (mant / 1024)
  if (exp === 0x1f) return mant ? Number.NaN : sign * Number.POSITIVE_INFINITY
  return sign * 2 ** (exp - 15) * (1 + mant / 1024)
}

function assertFloat16() {
  const pairs = [
    [1, 0x3c00],
    [-1, 0xbc00],
    [0.5, 0x3800],
    [2, 0x4000],
    [65504, 0x7bff],
    [-65504, 0xfbff],
    [0, 0x0000],
    [1e6, 0x7bff],
    [-1e6, 0xfbff],
    [1.00048828125, 0x3c00],
    [1.00146484375, 0x3c02],
    [2 ** -24, 0x0001],
  ]
  for (const pair of pairs) {
    if (floatToHalf(pair[0]) !== pair[1]) fail('float16 encode ' + pair[0])
  }
  if (floatToHalf(Number.NaN) !== 0x7e00) fail('float16 nan')
  const raw = Uint8Array.from([
    0x00, 0x3c, 0x00, 0xbc, 0x00, 0x7e, 0xff, 0x7b, 0xff, 0xfb, 0x00, 0x00, 0x00, 0x38, 0x00, 0x40,
  ])
  const expected = [1, -1, Number.NaN, 65504, -65504, 0, 0.5, 2]
  for (let i = 0; i < expected.length; i += 1) {
    const h = raw[i * 2] | (raw[i * 2 + 1] << 8)
    const got = halfToFloat(h)
    const want = expected[i]
    if (Number.isNaN(want) ? !Number.isNaN(got) : got !== want) fail('float16 vector ' + i)
  }
}

function writeHalf(buf, offset, value) {
  const h = floatToHalf(value)
  buf[offset] = h & 0xff
  buf[offset + 1] = (h >> 8) & 0xff
}

function readHalf(buf, offset) {
  return halfToFloat(buf[offset] | (buf[offset + 1] << 8))
}

function byteOffset(item, plane, y, x) {
  return (((item * 2 + plane) * H + y) * W + x) * 2
}

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    c ^= bytes[i]
    for (let k = 0; k < 8; k += 1) {
      const bit = c & 1
      c = (c >>> 1) ^ (bit ? 0xedb88320 : 0)
    }
  }
  return (c ^ 0xffffffff) >>> 0
}

function concatBytes(parts) {
  let length = 0
  for (const part of parts) length += part.length
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function writeU32BE(arr, value, offset) {
  arr[offset] = (value >>> 24) & 0xff
  arr[offset + 1] = (value >>> 16) & 0xff
  arr[offset + 2] = (value >>> 8) & 0xff
  arr[offset + 3] = value & 0xff
}

function pngChunk(type, data) {
  const typeBytes = Uint8Array.from(type.split('').map((ch) => ch.charCodeAt(0)))
  const body = concatBytes([typeBytes, data])
  const length = new Uint8Array(4)
  const crc = new Uint8Array(4)
  writeU32BE(length, data.length, 0)
  writeU32BE(crc, crc32(body), 0)
  return concatBytes([length, body, crc])
}

function encodePng(width, height, rgb) {
  if (rgb.length !== width * height * 3) fail('png rgb size')
  const raw = new Uint8Array(height * (1 + width * 3))
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3)
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 3
      const dst = row + 1 + x * 3
      raw[dst] = rgb[src]
      raw[dst + 1] = rgb[src + 1]
      raw[dst + 2] = rgb[src + 2]
    }
  }
  const compressed = deflateSync(raw, { level: 9 })
  const back = inflateSync(compressed)
  if (back.length !== raw.length) fail('png deflate size')
  for (let i = 0; i < raw.length; i += 1) if (back[i] !== raw[i]) fail('png deflate bytes')
  const ihdr = new Uint8Array(13)
  writeU32BE(ihdr, width, 0)
  writeU32BE(ihdr, height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
  return concatBytes([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', new Uint8Array(0)),
  ])
}

function assertCrc() {
  const text = Uint8Array.from([49, 50, 51, 52, 53, 54, 55, 56, 57])
  if (crc32(text) !== 0xcbf43926) fail('crc32')
}

function yearOf(mjd) {
  return 2000 + (mjd - 51544.5) / 365.25
}

function propagate(ra0, dec0, epochYear, pmra, pmdec, mjd) {
  if (pmra === null || pmdec === null) return { ra: ra0, dec: dec0 }
  const dt = yearOf(mjd) - epochYear
  return {
    ra: ra0 + ((pmra / MAS_PER_DEG) * dt) / Math.cos(dec0 * DEG),
    dec: dec0 + (pmdec / MAS_PER_DEG) * dt,
  }
}

function worldToPixel(ra, dec, grid) {
  const raC = grid.crval1_deg * DEG
  const decC = grid.crval2_deg * DEG
  const raR = ra * DEG
  const decR = dec * DEG
  const cosD = Math.cos(decR)
  const sinD = Math.sin(decR)
  const cosC = Math.cos(decC)
  const sinC = Math.sin(decC)
  const dRa = raR - raC
  const denom = sinC * sinD + cosC * cosD * Math.cos(dRa)
  const xi = (cosD * Math.sin(dRa)) / denom / DEG
  const eta = (cosC * sinD - sinC * cosD * Math.cos(dRa)) / denom / DEG
  return {
    x: grid.crpix1 - 1 + xi / grid.cdelt1_deg,
    y: grid.crpix2 - 1 + eta / grid.cdelt2_deg,
  }
}

function separationArcsec(ra1, dec1, ra2, dec2) {
  const d1 = dec1 * DEG
  const d2 = dec2 * DEG
  const cosang = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos((ra1 - ra2) * DEG)
  const clamped = Math.min(1, Math.max(-1, cosang))
  return (Math.acos(clamped) / DEG) * 3600
}

function mjdToIso(mjd) {
  return new Date(Math.round((mjd - 40587) * 86400000)).toISOString()
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

function buildChannels() {
  const rows = []
  for (let band = 1; band <= 6; band += 1) {
    const lo = BAND_EDGES[band - 1]
    const hi = BAND_EDGES[band]
    const width = (hi - lo) / 17
    for (let bandChannel = 1; bandChannel <= 17; bandChannel += 1) {
      rows.push({
        channel: 17 * (band - 1) + (bandChannel - 1),
        band,
        band_channel: bandChannel,
        lambda_um: lo + width * (bandChannel - 0.5),
        bandwidth_um: width,
      })
    }
  }
  return rows
}

function nearestChannel(channels, lambda) {
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < channels.length; i += 1) {
    const distance = Math.abs(channels[i].lambda_um - lambda)
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  return best
}

function validChannelList() {
  const list = []
  for (let channel = 0; channel <= 101; channel += 1) if (channel !== 50 && channel !== 51) list.push(channel)
  return list
}

function nearestValidChannel(channels, lambda) {
  let best = 0
  let bestDistance = Infinity
  for (const channel of validChannelList()) {
    const distance = Math.abs(channels[channel].lambda_um - lambda)
    if (distance < bestDistance) {
      bestDistance = distance
      best = channel
    }
  }
  return best
}

function continuumChannels(onChannel) {
  const valid = validChannelList()
  const index = valid.indexOf(onChannel)
  if (index < 0) fail('feature line on_channel is not valid')
  return valid.slice(Math.max(0, index - 2), index).concat(valid.slice(index + 1, index + 3))
}

function range(start, end) {
  const out = []
  for (let i = start; i <= end; i += 1) out.push(i)
  return out
}

function frameKey(detector, channel, mjd) {
  return 'synth_d' + detector + '_c' + String(channel).padStart(3, '0') + '_m' + mjd.toFixed(1).replace('.', 'p')
}

function buildSchedule(channels) {
  const rows = [
    {
      detector: 1,
      channel: 4,
      mjd: 60400,
      hot: 0,
      outlier: 0,
      align: 0.12,
      version: '1.0.0',
      saturate: false,
      nullFlux: false,
      nullCentroid: false,
    },
    {
      detector: 1,
      channel: 12,
      mjd: 60400.5,
      hot: 0.1,
      outlier: 0,
      align: 0.2,
      version: '1.0.0',
      saturate: false,
      nullFlux: false,
      nullCentroid: false,
    },
    {
      detector: 2,
      channel: 20,
      mjd: 60410,
      hot: 0,
      outlier: 0.3,
      align: null,
      version: '1.0.0',
      saturate: false,
      nullFlux: false,
      nullCentroid: false,
    },
    {
      detector: 2,
      channel: 28,
      mjd: 60410.5,
      hot: 0,
      outlier: 0,
      align: 0.05,
      version: '1.0.0',
      saturate: true,
      nullFlux: false,
      nullCentroid: false,
    },
    {
      detector: 1,
      channel: 4,
      mjd: 60450,
      hot: 0,
      outlier: 0,
      align: 0.11,
      version: '1.0.0',
      saturate: false,
      nullFlux: true,
      nullCentroid: false,
    },
    {
      detector: 1,
      channel: 12,
      mjd: 60450.5,
      hot: 0,
      outlier: 0,
      align: 0.09,
      version: null,
      saturate: false,
      nullFlux: false,
      nullCentroid: true,
    },
    {
      detector: 2,
      channel: 20,
      mjd: 60460,
      hot: 0,
      outlier: 0,
      align: 0.14,
      version: '1.0.0',
      saturate: false,
      nullFlux: false,
      nullCentroid: false,
    },
    {
      detector: 2,
      channel: 28,
      mjd: 60460.5,
      hot: 0,
      outlier: 0,
      align: 0.18,
      version: '1.0.0',
      saturate: false,
      nullFlux: false,
      nullCentroid: false,
    },
    {
      detector: 1,
      channel: 4,
      mjd: 60580,
      hot: 0,
      outlier: 0,
      align: 0.07,
      version: '1.0.0',
      saturate: false,
      nullFlux: false,
      nullCentroid: false,
    },
    {
      detector: 1,
      channel: 12,
      mjd: 60580.5,
      hot: 0,
      outlier: 0,
      align: 0.16,
      version: '1.0.0',
      saturate: false,
      nullFlux: false,
      nullCentroid: false,
    },
    {
      detector: 2,
      channel: 20,
      mjd: 60590,
      hot: 0,
      outlier: 0,
      align: 0.13,
      version: '1.0.0',
      saturate: false,
      nullFlux: false,
      nullCentroid: false,
    },
    {
      detector: 2,
      channel: 28,
      mjd: 60590.5,
      hot: 0,
      outlier: 0,
      align: 0.1,
      version: '1.0.0',
      saturate: false,
      nullFlux: false,
      nullCentroid: false,
    },
  ]
  return rows.map((row) => {
    const channel = channels[row.channel]
    return {
      ...row,
      frame_key: frameKey(row.detector, row.channel, row.mjd),
      lambda_um: channel.lambda_um,
      bandwidth_um: channel.bandwidth_um,
      lambda_min_um: channel.lambda_um - channel.bandwidth_um / 2,
      lambda_max_um: channel.lambda_um + channel.bandwidth_um / 2,
      index: 0,
      epoch_id: 0,
      target_ra_deg: 0,
      target_dec_deg: 0,
      target_x: 0,
      target_y: 0,
      good_fraction: 0,
      saturated_pixels: 0,
      source_uri: '',
      obs_time_utc: '',
    }
  })
}

function compareFrames(a, b) {
  if (a.mjd !== b.mjd) return a.mjd - b.mjd
  if (a.detector !== b.detector) return a.detector - b.detector
  if (a.frame_key < b.frame_key) return -1
  if (a.frame_key > b.frame_key) return 1
  return 0
}

function assignEpochs(frames) {
  const epochs = []
  for (const frame of frames) {
    const last = epochs[epochs.length - 1]
    const prev = last ? last.frames[last.frames.length - 1] : null
    if (!last || !prev || frame.mjd - prev.mjd > EPOCH_GAP_DAYS) epochs.push({ frames: [frame] })
    else last.frames.push(frame)
  }
  for (let id = 0; id < epochs.length; id += 1) {
    for (const frame of epochs[id].frames) frame.epoch_id = id
  }
  return epochs
}

function flagFractions(frame) {
  const fractions = {}
  for (const pair of FLAG_BITS) fractions[pair[0]] = 0
  if (frame.hot) fractions.HOT = frame.hot
  if (frame.outlier) fractions.OUTLIER = frame.outlier
  return fractions
}

function contaminationLevel(fractions) {
  let max = 0
  for (const pair of FLAG_BITS) if (fractions[pair[0]] > max) max = fractions[pair[0]]
  if (max >= CONTAMINATION_SEVERE) return 2
  if (max === 0) return 0
  return 1
}

function isNanPixel(x, y) {
  const corner = (x === 0 || x === W - 1) && (y === 0 || y === H - 1)
  return corner || (y === 0 && x === W >> 1)
}

function renderFrames(frames) {
  const buf = new Uint8Array(frames.length * 2 * H * W * 2)
  const rng = mulberry32(0x5eedf2)
  for (const frame of frames) {
    let finite = 0
    let saturated = 0
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const noise = rng()
        const sigmaNoise = rng()
        let intensity = 1 + 0.2 * (x / (W - 1)) + 0.1 * (y / (H - 1)) + 0.03 * (noise - 0.5)
        const dx = x - frame.target_x
        const dy = y - frame.target_y
        intensity += 40 * Math.exp(-(dx * dx + dy * dy) / (2 * 1.15 * 1.15))
        const sigma = 0.2 + 0.1 * sigmaNoise
        if (frame.saturate && x === 1 && y === 1) intensity = 100000
        const off0 = byteOffset(frame.index, 0, y, x)
        const off1 = byteOffset(frame.index, 1, y, x)
        if (isNanPixel(x, y)) {
          writeHalf(buf, off0, Number.NaN)
          writeHalf(buf, off1, Number.NaN)
        } else {
          if (Math.abs(intensity) > 65504) saturated += 1
          if (Math.abs(sigma) > 65504) saturated += 1
          writeHalf(buf, off0, intensity)
          writeHalf(buf, off1, sigma)
          finite += 1
        }
      }
    }
    frame.good_fraction = finite / (H * W)
    frame.saturated_pixels = saturated
  }
  return buf
}

function toFrameJson(frame) {
  const fractions = flagFractions(frame)
  return {
    index: frame.index,
    frame_key: frame.frame_key,
    obs_id: 'SYN' + String(frame.index).padStart(4, '0'),
    release: frame.index % 2 === 0 ? 'dr1' : 'qr3',
    processing_version: frame.version,
    detector: frame.detector,
    mjd: frame.mjd,
    obs_time_utc: frame.obs_time_utc,
    epoch_id: frame.epoch_id,
    lambda_um: frame.lambda_um,
    bandwidth_um: frame.bandwidth_um,
    lambda_min_um: frame.lambda_min_um,
    lambda_max_um: frame.lambda_max_um,
    channel: frame.channel,
    target_ra_deg: frame.target_ra_deg,
    target_dec_deg: frame.target_dec_deg,
    target_x: frame.target_x,
    target_y: frame.target_y,
    good_fraction: frame.good_fraction,
    aperture_pixels: APERTURE_PIXELS,
    flag_fractions: fractions,
    contamination_level: contaminationLevel(fractions),
    saturated_pixels: frame.saturated_pixels,
    alignment_residual_px: frame.align,
    source_uri: frame.source_uri,
  }
}

function toEpochJson(epoch, id) {
  let mjdMin = epoch.frames[0].mjd
  let mjdMax = epoch.frames[0].mjd
  let sum = 0
  const detectors = []
  for (const frame of epoch.frames) {
    sum += frame.mjd
    if (frame.mjd < mjdMin) mjdMin = frame.mjd
    if (frame.mjd > mjdMax) mjdMax = frame.mjd
    if (!detectors.includes(frame.detector)) detectors.push(frame.detector)
  }
  detectors.sort((a, b) => a - b)
  return {
    epoch_id: id,
    mjd_start: mjdMin,
    mjd_end: mjdMax,
    mjd_mean: sum / epoch.frames.length,
    n_frames: epoch.frames.length,
    detectors,
  }
}

function memberStats(members) {
  let mjdMin = members[0].mjd
  let mjdMax = members[0].mjd
  let mjdSum = 0
  let lambdaSum = 0
  let lambdaMin = members[0].lambda_min_um
  let lambdaMax = members[0].lambda_max_um
  const indices = []
  for (const frame of members) {
    indices.push(frame.index)
    mjdSum += frame.mjd
    lambdaSum += frame.lambda_um
    if (frame.mjd < mjdMin) mjdMin = frame.mjd
    if (frame.mjd > mjdMax) mjdMax = frame.mjd
    if (frame.lambda_min_um < lambdaMin) lambdaMin = frame.lambda_min_um
    if (frame.lambda_max_um > lambdaMax) lambdaMax = frame.lambda_max_um
  }
  indices.sort((a, b) => a - b)
  return {
    n_frames: members.length,
    frame_indices: indices,
    mjd_min: mjdMin,
    mjd_max: mjdMax,
    mjd_mean: mjdSum / members.length,
    lambda_mean_um: lambdaSum / members.length,
    lambda_min_um: lambdaMin,
    lambda_max_um: lambdaMax,
  }
}

function groupFrames(frames, keyOf) {
  const groups = []
  for (const frame of frames) {
    const key = keyOf(frame)
    let group = null
    for (const existing of groups) if (existing.key === key) group = existing
    if (!group) {
      group = { key, frames: [] }
      groups.push(group)
    }
    group.frames.push(frame)
  }
  return groups
}

function combine(frameBuf, indices) {
  const intensity = new Float64Array(H * W)
  const sigma = new Float64Array(H * W)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let sumW = 0
      let sumWI = 0
      for (const item of indices) {
        const value = readHalf(frameBuf, byteOffset(item, 0, y, x))
        const err = readHalf(frameBuf, byteOffset(item, 1, y, x))
        if (!Number.isFinite(value) || !Number.isFinite(err) || !(err > 0)) continue
        const weight = 1 / (err * err)
        sumW += weight
        sumWI += weight * value
      }
      const pixel = y * W + x
      if (sumW > 0) {
        intensity[pixel] = sumWI / sumW
        sigma[pixel] = Math.sqrt(1 / sumW)
      } else {
        intensity[pixel] = Number.NaN
        sigma[pixel] = Number.NaN
      }
    }
  }
  return { intensity, sigma }
}

function writePlanes(buf, item, planes) {
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const pixel = y * W + x
      writeHalf(buf, byteOffset(item, 0, y, x), planes.intensity[pixel])
      writeHalf(buf, byteOffset(item, 1, y, x), planes.sigma[pixel])
    }
  }
}

function snrTarget(buf, item, pixel) {
  const samplesI = []
  const samplesV = []
  const annulus = []
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const radius = Math.hypot(x - pixel.x, y - pixel.y)
      const intensity = readHalf(buf, byteOffset(item, 0, y, x))
      const sigma = readHalf(buf, byteOffset(item, 1, y, x))
      if (!Number.isFinite(intensity) || !Number.isFinite(sigma)) continue
      if (radius <= 3) {
        samplesI.push(intensity)
        samplesV.push(sigma * sigma)
      }
      if (radius >= 6 && radius <= 10) annulus.push(intensity)
    }
  }
  if (samplesI.length === 0 || annulus.length === 0) return null
  let sumI = 0
  let sumV = 0
  for (let i = 0; i < samplesI.length; i += 1) {
    sumI += samplesI[i]
    sumV += samplesV[i]
  }
  const sigmaF = Math.sqrt(sumV)
  if (!(sigmaF > 0)) return null
  const snr = (sumI - samplesI.length * median(annulus)) / sigmaF
  return Number.isFinite(snr) ? snr : null
}

function buildCoadds(frames, frameBuf, grid, ra0, dec0) {
  const epochGroups = groupFrames(frames, (frame) => frame.epoch_id + ':' + frame.detector)
  epochGroups.sort((a, b) => {
    const [aEpoch, aDet] = a.key.split(':').map(Number)
    const [bEpoch, bDet] = b.key.split(':').map(Number)
    return aEpoch - bEpoch || aDet - bDet
  })
  const detectorGroups = groupFrames(frames, (frame) => String(frame.detector))
  detectorGroups.sort((a, b) => Number(a.key) - Number(b.key))
  const channelGroups = groupFrames(frames, (frame) => String(frame.channel))
  channelGroups.sort((a, b) => Number(a.key) - Number(b.key))

  const records = []
  for (const group of epochGroups) {
    const [epochId, detector] = group.key.split(':').map(Number)
    records.push({ scope: 'epoch_detector', epoch_id: epochId, detector, channel: null, ...memberStats(group.frames) })
  }
  for (const group of detectorGroups) {
    records.push({
      scope: 'detector',
      epoch_id: null,
      detector: Number(group.key),
      channel: null,
      ...memberStats(group.frames),
    })
  }
  for (const group of channelGroups) {
    const channel = Number(group.key)
    records.push({
      scope: 'channel',
      epoch_id: null,
      detector: Math.floor(channel / 17) + 1,
      channel,
      ...memberStats(group.frames),
    })
  }
  records.forEach((record, index) => {
    record.index = index
  })
  const buf = new Uint8Array(records.length * 2 * H * W * 2)
  records.forEach((record) => writePlanes(buf, record.index, combine(frameBuf, record.frame_indices)))
  for (const record of records) {
    const at = propagate(ra0, dec0, COORD_EPOCH, PMRA, PMDEC, record.mjd_mean)
    record.snr_target = snrTarget(buf, record.index, worldToPixel(at.ra, at.dec, grid))
  }
  return { records, buf }
}

function toCoaddJson(record) {
  return {
    index: record.index,
    scope: record.scope,
    epoch_id: record.epoch_id,
    detector: record.detector,
    channel: record.channel,
    n_frames: record.n_frames,
    frame_indices: record.frame_indices,
    mjd_min: record.mjd_min,
    mjd_max: record.mjd_max,
    mjd_mean: record.mjd_mean,
    lambda_mean_um: record.lambda_mean_um,
    lambda_min_um: record.lambda_min_um,
    lambda_max_um: record.lambda_max_um,
    snr_target: record.snr_target,
  }
}

function featureLines(channels) {
  return LINE_MARKERS.map((line) => {
    const onChannel = nearestValidChannel(channels, line.lambda_um)
    return {
      name: line.name,
      lambda_um: line.lambda_um,
      on_channel: onChannel,
      continuum_channels: continuumChannels(onChannel),
    }
  })
}

function buildSed(frames) {
  return frames.map((frame) => {
    const level = contaminationLevel(flagFractions(frame))
    const base = 8 + frame.channel * 0.15
    return {
      frame_index: frame.index,
      epoch_id: frame.epoch_id,
      detector: frame.detector,
      channel: frame.channel,
      mjd: frame.mjd,
      obs_time_utc: frame.obs_time_utc,
      lambda_um: frame.lambda_um,
      bandwidth_um: frame.bandwidth_um,
      flux_mjy: frame.nullFlux ? [null, null, null] : [base, base * 1.2, base * 1.45],
      flux_err_mjy: frame.nullFlux ? [null, null, null] : [0.4, 0.35, 0.3],
      flagged: level !== 0,
      centroid_x: frame.nullCentroid ? null : frame.target_x + 0.04,
      centroid_y: frame.nullCentroid ? null : frame.target_y - 0.03,
      centroid_err_px: frame.nullCentroid ? null : 0.11,
    }
  })
}

function buildGaia(framesEpochs, center, grid, ra0, dec0) {
  const epochs = framesEpochs.map((epoch, id) => toEpochJson(epoch, id))
  const offsets = [
    {
      id: '4472832130942575872',
      ra: ra0,
      dec: dec0,
      pmra: PMRA,
      pmdec: PMDEC,
      parallax: 546.975,
      parallaxErr: 0.03,
      mag: 9.511,
    },
    {
      id: '4472832130942576001',
      ra: ra0 + 3 / 3600 / Math.cos(dec0 * DEG),
      dec: dec0,
      pmra: 0,
      pmdec: 0,
      parallax: 2.5,
      parallaxErr: 0.2,
      mag: 14.2,
    },
    {
      id: '4472832130942576002',
      ra: ra0 + 8 / 3600 / Math.cos(dec0 * DEG),
      dec: dec0 + 1 / 3600,
      pmra: 0,
      pmdec: 0,
      parallax: 0.8,
      parallaxErr: 0.5,
      mag: 17.8,
    },
  ]
  const sources = offsets.map((source) => {
    const at = propagate(source.ra, source.dec, COORD_EPOCH, source.pmra, source.pmdec, center.t_mid_mjd)
    return {
      source_id: source.id,
      ra_deg: source.ra,
      dec_deg: source.dec,
      ref_epoch_year: COORD_EPOCH,
      pmra_mas_yr: source.pmra,
      pmdec_mas_yr: source.pmdec,
      parallax_mas: source.parallax,
      parallax_error_mas: source.parallaxErr,
      phot_g_mean_mag: source.mag,
      separation_arcsec: separationArcsec(at.ra, at.dec, center.ra_deg, center.dec_deg),
      is_primary: false,
      predicted_track: null,
      pmra: source.pmra,
      pmdec: source.pmdec,
    }
  })
  sources.sort((a, b) => a.separation_arcsec - b.separation_arcsec)
  const primary = sources[0]
  if (!primary || !(primary.separation_arcsec <= 10)) fail('gaia primary is outside the match radius')
  primary.is_primary = true
  primary.predicted_track = epochs.map((epoch) => {
    const at = propagate(primary.ra_deg, primary.dec_deg, COORD_EPOCH, primary.pmra, primary.pmdec, epoch.mjd_mean)
    const pix = worldToPixel(at.ra, at.dec, grid)
    return { epoch_id: epoch.epoch_id, mjd: epoch.mjd_mean, ra_deg: at.ra, dec_deg: at.dec, x: pix.x, y: pix.y }
  })
  const radius = 10
  const adql = [
    'SELECT source_id, ra, dec, ref_epoch, pmra, pmdec, parallax, parallax_error, phot_g_mean_mag',
    'FROM gaiadr3.gaia_source',
    "WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', " + ra0 + ', ' + dec0 + ', ' + radius / 3600 + ')) = 1',
  ].join(' ')
  return {
    sources: sources.map((source) => ({
      source_id: source.source_id,
      ra_deg: source.ra_deg,
      dec_deg: source.dec_deg,
      ref_epoch_year: source.ref_epoch_year,
      pmra_mas_yr: source.pmra_mas_yr,
      pmdec_mas_yr: source.pmdec_mas_yr,
      parallax_mas: source.parallax_mas,
      parallax_error_mas: source.parallax_error_mas,
      phot_g_mean_mag: source.phot_g_mean_mag,
      separation_arcsec: source.separation_arcsec,
      is_primary: source.is_primary,
      predicted_track: source.predicted_track,
    })),
    primary_source_id: primary.source_id,
    radius,
    adql,
  }
}

function stretch(buf, item) {
  const values = []
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const value = readHalf(buf, byteOffset(item, 0, y, x))
      if (Number.isFinite(value)) values.push(value)
    }
  }
  values.sort((a, b) => a - b)
  return {
    lo: values[Math.floor(values.length * 0.01)],
    hi: values[Math.min(values.length - 1, Math.floor(values.length * 0.995))],
  }
}

function gray(value, lo, hi) {
  if (!Number.isFinite(value) || !(hi > lo)) return 0
  const t = (value - lo) / (hi - lo)
  if (t <= 0) return 0
  if (t >= 1) return 255
  return Math.round(t * 255)
}

function renderThumb(frameBuf) {
  const limits = stretch(frameBuf, 0)
  const rgb = new Uint8Array(W * H * 3)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const value = readHalf(frameBuf, byteOffset(0, 0, H - 1 - y, x))
      const g = gray(value, limits.lo, limits.hi)
      const offset = (y * W + x) * 3
      rgb[offset] = g
      rgb[offset + 1] = g
      rgb[offset + 2] = g
    }
  }
  return encodePng(W, H, rgb)
}

function renderEqualChannel(frameBuf) {
  const limits = [stretch(frameBuf, 2), stretch(frameBuf, 1), stretch(frameBuf, 0)]
  const items = [2, 1, 0]
  const rgb = new Uint8Array(W * H * 3)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const offset = (y * W + x) * 3
      for (let c = 0; c < 3; c += 1) {
        const value = readHalf(frameBuf, byteOffset(items[c], 0, H - 1 - y, x))
        rgb[offset + c] = gray(value, limits[c].lo, limits[c].hi)
      }
    }
  }
  return encodePng(W, H, rgb)
}

function dataVersionOf(uris) {
  const unique = []
  for (const uri of uris.slice().sort()) {
    if (unique.length === 0 || unique[unique.length - 1] !== uri) unique.push(uri)
  }
  return 'sha256:' + sha256(unique.join('\n'))
}

function toJson(value) {
  return JSON.stringify(value, null, 2) + '\n'
}

function badFlagBits() {
  const bits = {}
  for (const pair of FLAG_BITS) bits[pair[0]] = pair[1]
  return bits
}

function releasesOf(frameJson) {
  const releases = []
  for (const frame of frameJson) if (!releases.includes(frame.release)) releases.push(frame.release)
  releases.sort()
  return releases
}

function binaryDescriptor(file, nItems, bytes) {
  return {
    file,
    dtype: 'float16',
    byte_order: 'little',
    axes: ['item', 'plane', 'y', 'x'],
    planes: ['intensity', 'sigma'],
    unit: 'MJy/sr',
    n_items: nItems,
    height: H,
    width: W,
    bytes,
  }
}

function fileEntry(bytes) {
  return { bytes: bytes.length, sha256: sha256(bytes) }
}

function assertNanPair(buf, nItems) {
  let count = 0
  for (let item = 0; item < nItems; item += 1) {
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const a = readHalf(buf, byteOffset(item, 0, y, x))
        const b = readHalf(buf, byteOffset(item, 1, y, x))
        if (Number.isNaN(a) !== Number.isNaN(b)) fail('nan planes diverged')
        if (!Number.isNaN(a) && !(b > 0)) fail('sigma is not positive')
        if (Number.isNaN(a)) count += 1
      }
    }
  }
  if (count === 0) fail('expected edge NaNs')
}

function main() {
  if (H !== 30 || W !== 30) fail('grid is not 30x30')
  assertFloat16()
  assertCrc()
  const channels = buildChannels()
  if (channels.length !== 102) fail('channel table length')
  const frames = buildSchedule(channels)
  frames.sort(compareFrames)
  frames.forEach((frame, index) => {
    frame.index = index
  })
  const epochs = assignEpochs(frames)
  if (epochs.length !== 3) fail('expected 3 epochs, got ' + epochs.length)
  let mjdMin = frames[0].mjd
  let mjdMax = frames[0].mjd
  for (const frame of frames) {
    if (frame.mjd < mjdMin) mjdMin = frame.mjd
    if (frame.mjd > mjdMax) mjdMax = frame.mjd
  }
  if (!(mjdMax - mjdMin < 240)) fail('baseline is not under 240 days')
  const tMid = (mjdMin + mjdMax) / 2
  const dt = yearOf(tMid) - COORD_EPOCH
  const dec0 = CENTER_DEC - (PMDEC / MAS_PER_DEG) * dt
  const ra0 = CENTER_RA - ((PMRA / MAS_PER_DEG) * dt) / Math.cos(dec0 * DEG)
  const centerSky = propagate(ra0, dec0, COORD_EPOCH, PMRA, PMDEC, tMid)
  if (Math.abs(centerSky.ra - CENTER_RA) > 1e-9 || Math.abs(centerSky.dec - CENTER_DEC) > 1e-9) {
    fail('center did not land on the requested coordinates')
  }
  const cdelt = PIXEL_SCALE / 3600
  const grid = {
    size_deg: SIZE_DEG,
    width: W,
    height: H,
    projection: 'TAN',
    pixel_scale_arcsec: PIXEL_SCALE,
    crval1_deg: centerSky.ra,
    crval2_deg: centerSky.dec,
    crpix1: W / 2 + 0.5,
    crpix2: H / 2 + 0.5,
    cdelt1_deg: -cdelt,
    cdelt2_deg: cdelt,
  }
  const origin = worldToPixel(centerSky.ra, centerSky.dec, grid)
  if (Math.abs(origin.x - (W / 2 - 0.5)) > 1e-9 || Math.abs(origin.y - (H / 2 - 0.5)) > 1e-9) {
    fail('grid centre pixel is wrong')
  }
  for (const frame of frames) {
    const at = propagate(ra0, dec0, COORD_EPOCH, PMRA, PMDEC, frame.mjd)
    const pix = worldToPixel(at.ra, at.dec, grid)
    frame.target_ra_deg = at.ra
    frame.target_dec_deg = at.dec
    frame.target_x = pix.x
    frame.target_y = pix.y
    frame.obs_time_utc = mjdToIso(frame.mjd)
    frame.source_uri =
      'https://irsa.ipac.caltech.edu/ibe/search/spherex/cutout/' +
      frame.frame_key +
      '?center=' +
      at.ra +
      ',' +
      at.dec +
      '&size=0.05deg'
    if (nearestChannel(channels, frame.lambda_um) !== frame.channel) fail('channel is not the nearest wavelength')
  }
  if (Math.abs(frames[0].target_y - frames[frames.length - 1].target_y) < 0.5) fail('target blob does not move')
  const frameBuf = renderFrames(frames)
  const frameJson = frames.map(toFrameJson)
  const epochJson = epochs.map((epoch, id) => toEpochJson(epoch, id))
  const coadds = buildCoadds(frames, frameBuf, grid, ra0, dec0)
  if (coadds.records.some((record) => record.snr_target === null)) fail('snr_target was null')
  const lines = featureLines(channels)
  const coaddsDoc = {
    schema_version: SCHEMA_VERSION,
    slug: SLUG,
    data_version: '',
    n_coadds: coadds.records.length,
    coadds: coadds.records.map(toCoaddJson),
    rgb_presets: {
      detector_rgb: null,
      equal_channel_rgb: {
        blue_channels: range(0, 32),
        green_channels: range(33, 49).concat(range(52, 67)),
        red_channels: range(68, 101),
      },
      feature_lines: lines,
    },
  }
  const sedPoints = buildSed(frames)
  const gaiaBuilt = buildGaia(
    epochs,
    { ra_deg: centerSky.ra, dec_deg: centerSky.dec, t_mid_mjd: tMid },
    grid,
    ra0,
    dec0,
  )
  const dataVersion = dataVersionOf(frameJson.map((frame) => frame.source_uri))
  const framesDoc = {
    schema_version: SCHEMA_VERSION,
    slug: SLUG,
    data_version: dataVersion,
    n_frames: frameJson.length,
    epochs: epochJson,
    frames: frameJson,
  }
  coaddsDoc.data_version = dataVersion
  const sedDoc = {
    schema_version: SCHEMA_VERSION,
    slug: SLUG,
    data_version: dataVersion,
    flux_unit: 'mJy',
    wavelength_unit: 'um',
    aperture_radii_px: [3, 4, 5],
    primary_aperture_index: 0,
    annulus_px: [6, 10],
    solid_angle_source: 'nominal_pixel',
    nominal_pixel_sr: 8.8897e-10,
    n_points: sedPoints.length,
    points: sedPoints,
  }
  const gaiaDoc = {
    schema_version: SCHEMA_VERSION,
    slug: SLUG,
    data_version: dataVersion,
    query_status: 'ok',
    query: {
      endpoint: 'https://gea.esac.esa.int/tap-server/tap',
      table: 'gaiadr3.gaia_source',
      center_ra_deg: ra0,
      center_dec_deg: dec0,
      radius_arcsec: gaiaBuilt.radius,
      executed_utc: FIXED_UTC,
      adql: gaiaBuilt.adql,
    },
    match_radius_arcsec: 10,
    n_sources_in_cone: gaiaBuilt.sources.length,
    verdict: 'match_consistent',
    verdict_detail:
      'The primary Gaia source lies within the match radius and no measured proper motion is available, so the match is treated as consistent.',
    primary_source_id: gaiaBuilt.primary_source_id,
    measured_pm: null,
    consistency: null,
    sources: gaiaBuilt.sources,
  }
  const levels = frameJson.map((frame) => frame.contamination_level)
  if (!levels.includes(1) || !levels.includes(2)) fail('missing contamination levels')
  if (!frameJson.some((frame) => frame.alignment_residual_px === null)) fail('missing null alignment')
  if (!frameJson.some((frame) => frame.saturated_pixels > 0)) fail('missing saturated pixels')
  if (!sedPoints.some((point) => point.flux_mjy.every((value) => value === null))) fail('missing null flux')
  if (
    !sedPoints.some((point) => point.centroid_x === null && point.centroid_y === null && point.centroid_err_px === null)
  ) {
    fail('missing null centroid')
  }
  assertNanPair(frameBuf, frames.length)
  assertNanPair(coadds.buf, coadds.records.length)

  const framesJson = toJson(framesDoc)
  const coaddsJson = toJson(coaddsDoc)
  const sedJson = toJson(sedDoc)
  const gaiaJson = toJson(gaiaDoc)
  const thumb = renderThumb(frameBuf)
  const equalPng = renderEqualChannel(frameBuf)
  const files = {
    'frames.json': framesJson,
    'frames.bin': frameBuf,
    'coadds.json': coaddsJson,
    'coadds.bin': coadds.buf,
    'sed.json': sedJson,
    'gaia.json': gaiaJson,
  }
  const meta = {
    schema_version: SCHEMA_VERSION,
    slug: SLUG,
    tier: 'tier1',
    title: "Synthetic fixture: Barnard's Star (not a real observation)",
    status: 'complete',
    created_utc: FIXED_UTC,
    data_version: dataVersion,
    pipeline_version: '1.0.0',
    target: {
      name: "Barnard's Star (synthetic)",
      input_ra_deg: ra0,
      input_dec_deg: dec0,
      coord_epoch_year: COORD_EPOCH,
      coord_epoch_assumed: false,
      pmra_mas_yr: PMRA,
      pmdec_mas_yr: PMDEC,
      parallax_mas: 547,
      pm_source: 'gaia_dr3',
      pm_reference: 'gaiadr3.gaia_source',
    },
    center: { ra_deg: centerSky.ra, dec_deg: centerSky.dec, t_mid_mjd: tMid },
    observations: {
      n_frames: frameJson.length,
      n_epochs: epochJson.length,
      mjd_min: mjdMin,
      mjd_max: mjdMax,
      releases: releasesOf(frameJson),
      n_failed_fetches: 0,
      failed_source_uris: [],
    },
    grid,
    binaries: {
      frames: binaryDescriptor('frames.bin', frameJson.length, frameBuf.length),
      coadds: binaryDescriptor('coadds.bin', coadds.records.length, coadds.buf.length),
    },
    processing: {
      bad_mask: 712439,
      bad_flag_bits: badFlagBits(),
      benign_flag_bits: { SOURCE: 21 },
      photometry_radii_px: [3, 4, 5],
      annulus_px: [6, 10],
      background_model: 'zodi_subtracted_plus_local_sigma_clipped',
      reprojection: 'interp',
      epoch_gap_days: EPOCH_GAP_DAYS,
      contamination_severe_fraction: CONTAMINATION_SEVERE,
      pm_fit_min_epochs: 3,
      pm_fit_min_baseline_days: 300,
      line_markers: LINE_MARKERS,
    },
    channels,
    previews: {
      thumb: 'previews/thumb.png',
      rgb_detector: null,
      rgb_equal_channel: 'previews/rgb_equal_channel.png',
      stretch: { type: 'asinh', lower_percentile: 1.0, upper_percentile: 99.5 },
    },
    files: {
      'frames.json': fileEntry(framesJson),
      'frames.bin': fileEntry(frameBuf),
      'coadds.json': fileEntry(coaddsJson),
      'coadds.bin': fileEntry(coadds.buf),
      'sed.json': fileEntry(sedJson),
      'gaia.json': fileEntry(gaiaJson),
    },
  }
  const metaJson = toJson(meta)
  const dir = outputDir()
  mkdirSync(dir + '/previews', { recursive: true })
  const stray = dir + '/previews/rgb_detector.png'
  if (existsSync(stray)) rmSync(stray)
  const order = [
    ['frames.bin', frameBuf],
    ['frames.json', framesJson],
    ['coadds.bin', coadds.buf],
    ['coadds.json', coaddsJson],
    ['sed.json', sedJson],
    ['gaia.json', gaiaJson],
    ['previews/thumb.png', thumb],
    ['previews/rgb_equal_channel.png', equalPng],
  ]
  for (const entry of order) writeFileSync(dir + '/' + entry[0], entry[1])
  writeFileSync(dir + '/meta.json', metaJson)
  if (existsSync(stray)) fail('rgb_detector.png must not be written')
  for (const name of Object.keys(files)) {
    const disk = readFileSync(dir + '/' + name)
    if (disk.length !== meta.files[name].bytes || sha256(disk) !== meta.files[name].sha256)
      fail('hash mismatch ' + name)
  }
  const metaDisk = readFileSync(dir + '/meta.json', 'utf8')
  if (metaDisk !== metaJson) fail('meta.json bytes changed')
  if (!metaDisk.endsWith('\n') || metaDisk.includes('\r')) fail('json line endings')
}

main()
