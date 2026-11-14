# DATA_CONTRACT.md — SPHEREx Sky Explorer

**Contract version:** `1.0.0` (Canonical v1)
**Scope:** every file under `/data/{slug}/`, the binary layouts of `frames.bin` and `coadds.bin`, `POST /api/jobs`, and `GET /api/jobs/{job_id}/events`.
**Normative keywords:** MUST, MUST NOT, SHOULD, MAY are used as in RFC 2119.

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Encoding | JSON files are UTF-8, no BOM, LF line endings. |
| Keys | `snake_case`. Units are encoded in key suffixes (`_deg`, `_um`, `_arcsec`, `_px`, `_mjy`, `_mas_yr`, `_mjd`, `_utc`, `_year`). |
| Numbers | Finite only. `NaN`, `Infinity` and `-Infinity` MUST NOT appear in JSON. Missing values are `null` where the schema allows it. Floats are serialized with shortest round-trip representation (float64). |
| Integers | Within ±2^53. Gaia `source_id` (up to 19 digits) is a **string**. |
| Angles | Decimal degrees, ICRS. `pmra_mas_yr` is μα* (already multiplied by cos δ). |
| Time | `mjd` is Modified Julian Date, float64, days (UTC scale as delivered by IRSA). `*_utc` strings are ISO 8601 UTC with `Z` and millisecond precision at most. |
| Wavelength | micrometres (`um`). |
| Image flux | MJy/sr. Photometric flux: mJy. |
| Strict producers | Producers MUST NOT emit fields that are not defined here. |
| Tolerant consumers | Consumers MUST ignore unknown fields within the same major version. |
| Versioning | Semantic. Every JSON file carries `"schema_version": "1.0.0"`. A major bump breaks consumers; a minor bump only adds optional fields. |
| Atomicity | A producer writes a complete result into a temporary directory and renames it to `/data/{slug}/`. `meta.json` is the last file written. A directory without `meta.json` MUST NOT be served. |
| Immutability | Files in a published `/data/{slug}/` directory are immutable. A rebuild replaces the whole directory atomically and changes `data_version`. |

---

## 2. Directory layout

```
/data/{slug}/
  meta.json
  frames.json
  frames.bin
  coadds.json
  coadds.bin
  sed.json
  gaia.json
  previews/
    thumb.png
    rgb_detector.png          (omitted when meta.previews.rgb_detector is null)
    rgb_equal_channel.png
```

### 2.1 Slugs

`slug` matches `^[a-z0-9][a-z0-9-]{0,62}$`.

| Tier | Slugs |
|---|---|
| `tier1` | `barnards-star`, `wise-0855`, `eps-indi-b`, `rw-aur`, `r-dra` |
| `tier1_5` | `tutorial-m101`, `tutorial-cosmos`, `tutorial-intro`, `tutorial-hips` |
| `tier2` | `c-` + first 16 lowercase hex characters of SHA-256 over the UTF-8 request key (§11.3) |

---

## 3. Shared definitions

### 3.1 Time and position model

```
year(mjd)   = 2000.0 + (mjd - 51544.5) / 365.25            (Julian years)
Δt          = year(mjd) - target.coord_epoch_year
α(mjd)      = α0 + (pmra_mas_yr  / 3.6e6) · Δt / cos(δ0)    (degrees)
δ(mjd)      = δ0 + (pmdec_mas_yr / 3.6e6) · Δt              (degrees)
```

`α0 = target.input_ra_deg`, `δ0 = target.input_dec_deg`. When `pmra_mas_yr` and `pmdec_mas_yr` are `null`, `α(mjd) = α0` and `δ(mjd) = δ0`. Parallax is not applied.

`center` in `meta.json` is `α(t_mid_mjd), δ(t_mid_mjd)` with `t_mid_mjd = (observations.mjd_min + observations.mjd_max) / 2`.

### 3.2 Common grid

All reprojected products share one grid, defined in `meta.grid`:

| Property | Value |
|---|---|
| Projection | Gnomonic (`TAN`), north-up, no rotation |
| Pixel scale | `6.15` arcsec/pixel |
| Size | `width = height = 2 · ceil(size_deg · 3600 / (2 · 6.15))` |
| `crval1_deg`, `crval2_deg` | `center.ra_deg`, `center.dec_deg` |
| `crpix1`, `crpix2` (FITS, 1-based) | `width/2 + 0.5`, `height/2 + 0.5` |
| `cdelt1_deg` | `-6.15 / 3600` (RA increases toward lower `x`) |
| `cdelt2_deg` | `+6.15 / 3600` |

Resulting widths: `size_deg = 0.05 → 30`, `0.1 → 60`, `0.2 → 118`.

**Pixel coordinates** are 0-based, pixel centres at integer values, `x` along columns, `y` along rows. Array element `[y][x]` in `frames.bin` / `coadds.bin` is addressed with `y = 0` at the **southernmost** row and `x = 0` at the **easternmost** column (east is left, north is up when displayed with north up). The grid centre is at `x = width/2 - 0.5`, `y = height/2 - 0.5`.

**World → pixel** (all angles in degrees; `α, δ` the point; `α_c, δ_c` the grid centre):

```
D   = sin δ_c · sin δ + cos δ_c · cos δ · cos(α - α_c)
ξ   = (cos δ · sin(α - α_c) / D) · 180/π
η   = ((cos δ_c · sin δ - sin δ_c · cos δ · cos(α - α_c)) / D) · 180/π
x   = (crpix1 - 1) + ξ / cdelt1_deg
y   = (crpix2 - 1) + η / cdelt2_deg
```

**PNG files** use image convention: row 0 is the **northern** row (opposite to the binary arrays); column 0 is the eastern column.

### 3.3 Detectors and channels

`detector` is an integer 1–6 (SPHEREx bands 1–6; band number equals detector number).
`channel` is an integer 0–101 with `channel = 17 · (band − 1) + (band_channel − 1)`. Channels 50 and 51 are the dichroic channels. A frame's `channel` is the index of the channel whose `lambda_um` in `meta.channels` is nearest to the frame's `lambda_um` (ties resolve to the lower index).

### 3.4 Flag bits

`FLAGS` bit positions that mark a pixel as unusable ("bad bits"):

| Name | Bit | Name | Bit |
|---|---|---|---|
| `TRANSIENT` | 0 | `COLD` | 11 |
| `OVERFLOW` | 1 | `FULLSAMPLE` | 12 |
| `SUR_ERROR` | 2 | `PHANMISS` | 14 |
| `PHANTOM` | 4 | `NONLINEAR` | 15 |
| `REFERENCE` | 5 | `PERSIST` | 17 |
| `NONFUNC` | 6 | `OUTLIER` | 19 |
| `DICHROIC` | 7 | | |
| `MISSING_DATA` | 9 | | |
| `HOT` | 10 | | |

`BAD_MASK = 712439` (the sum of `2^bit` over the 15 bad bits). `SOURCE` (bit 21) is benign and is never part of `BAD_MASK`. A pixel is bad when `(flags & 712439) != 0`.

### 3.5 Epoch definition

Sort frames by `mjd`. Start a new epoch whenever the gap to the previous frame exceeds `processing.epoch_gap_days` (single-linkage clustering). `epoch_id` is assigned `0, 1, 2, …` in ascending time.

### 3.6 Contamination level

For a frame, with `aperture_pixels` and `flag_fractions` defined in §6:

```
contamination_level = 2   if aperture_pixels == 0
                          or max(flag_fractions.*) >= processing.contamination_severe_fraction
                    = 0   if max(flag_fractions.*) == 0
                    = 1   otherwise
```

---

## 4. `common.schema.json`

All other schemas reference these definitions as `common.schema.json#/$defs/<name>`.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://spherex-sky-explorer/schema/v1/common.schema.json",
  "$defs": {
    "schema_version": { "const": "1.0.0" },
    "slug": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{0,62}$" },
    "data_version": { "type": "string", "pattern": "^sha256:[0-9a-f]{64}$" },
    "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "iso_utc": {
      "type": "string",
      "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,3})?Z$"
    },
    "mjd": { "type": "number", "minimum": 60000, "maximum": 70000 },
    "ra_deg": { "type": "number", "minimum": 0, "exclusiveMaximum": 360 },
    "dec_deg": { "type": "number", "minimum": -90, "maximum": 90 },
    "detector": { "type": "integer", "minimum": 1, "maximum": 6 },
    "channel": { "type": "integer", "minimum": 0, "maximum": 101 },
    "release": { "enum": ["dr1", "qr3"] },
    "fraction": { "type": "number", "minimum": 0, "maximum": 1 },
    "size_deg": { "enum": [0.05, 0.1, 0.2] },
    "flag_name": {
      "enum": [
        "TRANSIENT", "OVERFLOW", "SUR_ERROR", "PHANTOM", "REFERENCE",
        "NONFUNC", "DICHROIC", "MISSING_DATA", "HOT", "COLD",
        "FULLSAMPLE", "PHANMISS", "NONLINEAR", "PERSIST", "OUTLIER"
      ]
    },
    "flag_fractions": {
      "type": "object",
      "propertyNames": { "$ref": "#/$defs/flag_name" },
      "additionalProperties": { "$ref": "#/$defs/fraction" },
      "minProperties": 15,
      "maxProperties": 15
    },
    "nullable_number": { "type": ["number", "null"] },
    "triple_nullable_number": {
      "type": "array",
      "items": { "type": ["number", "null"] },
      "minItems": 3,
      "maxItems": 3
    }
  }
}
```

---

## 5. `meta.json`

### 5.1 Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://spherex-sky-explorer/schema/v1/meta.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version", "slug", "tier", "title", "status", "created_utc",
    "data_version", "pipeline_version", "target", "center", "observations",
    "grid", "binaries", "processing", "channels", "previews", "files"
  ],
  "properties": {
    "schema_version": { "$ref": "common.schema.json#/$defs/schema_version" },
    "slug": { "$ref": "common.schema.json#/$defs/slug" },
    "tier": { "enum": ["tier1", "tier1_5", "tier2"] },
    "title": { "type": "string", "minLength": 1, "maxLength": 160 },
    "status": { "enum": ["complete", "partial"] },
    "created_utc": { "$ref": "common.schema.json#/$defs/iso_utc" },
    "data_version": { "$ref": "common.schema.json#/$defs/data_version" },
    "pipeline_version": { "type": "string", "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$" },

    "target": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name", "input_ra_deg", "input_dec_deg", "coord_epoch_year",
        "coord_epoch_assumed", "pmra_mas_yr", "pmdec_mas_yr", "parallax_mas",
        "pm_source", "pm_reference"
      ],
      "properties": {
        "name": { "type": ["string", "null"], "maxLength": 120 },
        "input_ra_deg": { "$ref": "common.schema.json#/$defs/ra_deg" },
        "input_dec_deg": { "$ref": "common.schema.json#/$defs/dec_deg" },
        "coord_epoch_year": { "type": "number", "minimum": 1900, "maximum": 2100 },
        "coord_epoch_assumed": { "type": "boolean" },
        "pmra_mas_yr": { "type": ["number", "null"] },
        "pmdec_mas_yr": { "type": ["number", "null"] },
        "parallax_mas": { "type": ["number", "null"] },
        "pm_source": { "enum": ["gaia_dr3", "literature", "user", "none"] },
        "pm_reference": { "type": ["string", "null"], "maxLength": 200 }
      }
    },

    "center": {
      "type": "object",
      "additionalProperties": false,
      "required": ["ra_deg", "dec_deg", "t_mid_mjd"],
      "properties": {
        "ra_deg": { "$ref": "common.schema.json#/$defs/ra_deg" },
        "dec_deg": { "$ref": "common.schema.json#/$defs/dec_deg" },
        "t_mid_mjd": { "$ref": "common.schema.json#/$defs/mjd" }
      }
    },

    "observations": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "n_frames", "n_epochs", "mjd_min", "mjd_max", "releases",
        "n_failed_fetches", "failed_source_uris"
      ],
      "properties": {
        "n_frames": { "type": "integer", "minimum": 0 },
        "n_epochs": { "type": "integer", "minimum": 0 },
        "mjd_min": { "$ref": "common.schema.json#/$defs/mjd" },
        "mjd_max": { "$ref": "common.schema.json#/$defs/mjd" },
        "releases": {
          "type": "array",
          "items": { "$ref": "common.schema.json#/$defs/release" },
          "uniqueItems": true
        },
        "n_failed_fetches": { "type": "integer", "minimum": 0 },
        "failed_source_uris": {
          "type": "array",
          "items": { "type": "string" },
          "maxItems": 500
        }
      }
    },

    "grid": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "size_deg", "width", "height", "projection", "pixel_scale_arcsec",
        "crval1_deg", "crval2_deg", "crpix1", "crpix2", "cdelt1_deg", "cdelt2_deg"
      ],
      "properties": {
        "size_deg": { "$ref": "common.schema.json#/$defs/size_deg" },
        "width": { "type": "integer", "minimum": 2 },
        "height": { "type": "integer", "minimum": 2 },
        "projection": { "const": "TAN" },
        "pixel_scale_arcsec": { "const": 6.15 },
        "crval1_deg": { "$ref": "common.schema.json#/$defs/ra_deg" },
        "crval2_deg": { "$ref": "common.schema.json#/$defs/dec_deg" },
        "crpix1": { "type": "number" },
        "crpix2": { "type": "number" },
        "cdelt1_deg": { "type": "number", "exclusiveMaximum": 0 },
        "cdelt2_deg": { "type": "number", "exclusiveMinimum": 0 }
      }
    },

    "binaries": {
      "type": "object",
      "additionalProperties": false,
      "required": ["frames", "coadds"],
      "properties": {
        "frames": { "$ref": "#/$defs/binary_descriptor" },
        "coadds": { "$ref": "#/$defs/binary_descriptor" }
      }
    },

    "processing": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "bad_mask", "bad_flag_bits", "benign_flag_bits", "photometry_radii_px",
        "annulus_px", "background_model", "reprojection", "epoch_gap_days",
        "contamination_severe_fraction", "pm_fit_min_epochs",
        "pm_fit_min_baseline_days", "line_markers"
      ],
      "properties": {
        "bad_mask": { "const": 712439 },
        "bad_flag_bits": {
          "type": "object",
          "propertyNames": { "$ref": "common.schema.json#/$defs/flag_name" },
          "additionalProperties": { "type": "integer", "minimum": 0, "maximum": 31 },
          "minProperties": 15,
          "maxProperties": 15
        },
        "benign_flag_bits": {
          "type": "object",
          "additionalProperties": false,
          "required": ["SOURCE"],
          "properties": { "SOURCE": { "const": 21 } }
        },
        "photometry_radii_px": { "const": [3, 4, 5] },
        "annulus_px": { "const": [6, 10] },
        "background_model": { "const": "zodi_subtracted_plus_local_sigma_clipped" },
        "reprojection": { "enum": ["interp", "exact"] },
        "epoch_gap_days": { "type": "number", "exclusiveMinimum": 0 },
        "contamination_severe_fraction": { "type": "number", "exclusiveMinimum": 0, "maximum": 1 },
        "pm_fit_min_epochs": { "const": 3 },
        "pm_fit_min_baseline_days": { "const": 300 },
        "line_markers": {
          "type": "array",
          "minItems": 8,
          "maxItems": 8,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["name", "lambda_um"],
            "properties": {
              "name": { "type": "string" },
              "lambda_um": { "type": "number", "exclusiveMinimum": 0 }
            }
          }
        }
      }
    },

    "channels": {
      "type": "array",
      "minItems": 102,
      "maxItems": 102,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["channel", "band", "band_channel", "lambda_um", "bandwidth_um"],
        "properties": {
          "channel": { "$ref": "common.schema.json#/$defs/channel" },
          "band": { "type": "integer", "minimum": 1, "maximum": 6 },
          "band_channel": { "type": "integer", "minimum": 1, "maximum": 17 },
          "lambda_um": { "type": "number", "exclusiveMinimum": 0 },
          "bandwidth_um": { "type": ["number", "null"], "exclusiveMinimum": 0 }
        }
      }
    },

    "previews": {
      "type": "object",
      "additionalProperties": false,
      "required": ["thumb", "rgb_detector", "rgb_equal_channel", "stretch"],
      "properties": {
        "thumb": { "const": "previews/thumb.png" },
        "rgb_detector": { "enum": ["previews/rgb_detector.png", null] },
        "rgb_equal_channel": { "const": "previews/rgb_equal_channel.png" },
        "stretch": {
          "type": "object",
          "additionalProperties": false,
          "required": ["type", "lower_percentile", "upper_percentile"],
          "properties": {
            "type": { "const": "asinh" },
            "lower_percentile": { "const": 1.0 },
            "upper_percentile": { "const": 99.5 }
          }
        }
      }
    },

    "files": {
      "type": "object",
      "additionalProperties": false,
      "required": ["frames.json", "frames.bin", "coadds.json", "coadds.bin", "sed.json", "gaia.json"],
      "properties": {
        "frames.json": { "$ref": "#/$defs/file_entry" },
        "frames.bin": { "$ref": "#/$defs/file_entry" },
        "coadds.json": { "$ref": "#/$defs/file_entry" },
        "coadds.bin": { "$ref": "#/$defs/file_entry" },
        "sed.json": { "$ref": "#/$defs/file_entry" },
        "gaia.json": { "$ref": "#/$defs/file_entry" }
      }
    }
  },
  "$defs": {
    "file_entry": {
      "type": "object",
      "additionalProperties": false,
      "required": ["bytes", "sha256"],
      "properties": {
        "bytes": { "type": "integer", "minimum": 0 },
        "sha256": { "$ref": "common.schema.json#/$defs/sha256" }
      }
    },
    "binary_descriptor": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "file", "dtype", "byte_order", "axes", "planes", "unit",
        "n_items", "height", "width", "bytes"
      ],
      "properties": {
        "file": { "enum": ["frames.bin", "coadds.bin"] },
        "dtype": { "const": "float16" },
        "byte_order": { "const": "little" },
        "axes": { "const": ["item", "plane", "y", "x"] },
        "planes": { "const": ["intensity", "sigma"] },
        "unit": { "const": "MJy/sr" },
        "n_items": { "type": "integer", "minimum": 0 },
        "height": { "type": "integer", "minimum": 2 },
        "width": { "type": "integer", "minimum": 2 },
        "bytes": { "type": "integer", "minimum": 0 }
      }
    }
  }
}
```

### 5.2 Fixed values written by producers

`processing.bad_flag_bits`:

```json
{
  "TRANSIENT": 0, "OVERFLOW": 1, "SUR_ERROR": 2, "PHANTOM": 4, "REFERENCE": 5,
  "NONFUNC": 6, "DICHROIC": 7, "MISSING_DATA": 9, "HOT": 10, "COLD": 11,
  "FULLSAMPLE": 12, "PHANMISS": 14, "NONLINEAR": 15, "PERSIST": 17, "OUTLIER": 19
}
```

`processing.line_markers` (in this order):

```json
[
  { "name": "Pa-beta", "lambda_um": 1.282 },
  { "name": "H-minus", "lambda_um": 1.60 },
  { "name": "Pa-alpha", "lambda_um": 1.875 },
  { "name": "Br-gamma", "lambda_um": 2.166 },
  { "name": "Br-beta", "lambda_um": 2.626 },
  { "name": "PAH-3.3", "lambda_um": 3.30 },
  { "name": "Br-alpha", "lambda_um": 4.052 },
  { "name": "CO", "lambda_um": 4.67 }
]
```

Default values: `processing.epoch_gap_days = 30`, `processing.contamination_severe_fraction = 0.25`, `processing.reprojection = "interp"`.

`channels` is the 102-row channel table read from the SPHEREx `SPECTRAL_CHANNELS` table, ordered by `channel`. `bandwidth_um` is `null` only when the source table provides none.

### 5.3 Cross-field invariants

1. `pmra_mas_yr`, `pmdec_mas_yr` are both `null` or both numbers; both `null` if and only if `pm_source == "none"`; `pm_reference` is `null` if and only if `pm_source` is `"none"` or `"user"`.
2. `coord_epoch_assumed = true` when the epoch was not supplied with the coordinates (default `coord_epoch_year = 2000.0`).
3. `center.*` follows §3.1. `grid.crval1_deg = center.ra_deg`, `grid.crval2_deg = center.dec_deg`; all other `grid.*` values follow §3.2.
4. `observations.n_frames = binaries.frames.n_items`; `binaries.*.height = grid.height`, `binaries.*.width = grid.width`.
5. `binaries.X.bytes = n_items × 2 × height × width × 2`, and equals `files["X.bin"].bytes`.
6. `status = "partial"` when `observations.n_failed_fetches > 0` after the backfill pass; otherwise `"complete"`.
7. `previews.rgb_detector = null` if and only if `coadds.json.rgb_presets.detector_rgb` is `null`.
8. `data_version = "sha256:" + SHA-256 (hex) of the UTF-8 text formed by the sorted `source_uri` values of all discovered exposures (after deduplication), joined with `\n``.
9. `files[*].sha256` is the SHA-256 of the file bytes exactly as served.

### 5.4 Example (illustrative values)

```json
{
  "schema_version": "1.0.0",
  "slug": "barnards-star",
  "tier": "tier1",
  "title": "Barnard's Star",
  "status": "complete",
  "created_utc": "2026-11-15T09:30:00.000Z",
  "data_version": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "pipeline_version": "1.0.0",
  "target": {
    "name": "Barnard's Star",
    "input_ra_deg": 269.45,
    "input_dec_deg": 4.69,
    "coord_epoch_year": 2016.0,
    "coord_epoch_assumed": false,
    "pmra_mas_yr": -798.0,
    "pmdec_mas_yr": 10328.0,
    "parallax_mas": 546.0,
    "pm_source": "gaia_dr3",
    "pm_reference": "gaiadr3.gaia_source"
  },
  "center": { "ra_deg": 269.4501, "dec_deg": 4.7122, "t_mid_mjd": 61100.0 },
  "observations": {
    "n_frames": 412,
    "n_epochs": 7,
    "mjd_min": 60800.5,
    "mjd_max": 61399.5,
    "releases": ["dr1", "qr3"],
    "n_failed_fetches": 0,
    "failed_source_uris": []
  },
  "grid": {
    "size_deg": 0.1,
    "width": 60,
    "height": 60,
    "projection": "TAN",
    "pixel_scale_arcsec": 6.15,
    "crval1_deg": 269.4501,
    "crval2_deg": 4.7122,
    "crpix1": 30.5,
    "crpix2": 30.5,
    "cdelt1_deg": -0.0017083333333333334,
    "cdelt2_deg": 0.0017083333333333334
  }
}
```

(The example is truncated after `grid` for brevity; a real file contains every required property.)

---

## 6. `frames.json`

One entry per frame in `frames.bin`.

### 6.1 Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://spherex-sky-explorer/schema/v1/frames.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "slug", "data_version", "n_frames", "epochs", "frames"],
  "properties": {
    "schema_version": { "$ref": "common.schema.json#/$defs/schema_version" },
    "slug": { "$ref": "common.schema.json#/$defs/slug" },
    "data_version": { "$ref": "common.schema.json#/$defs/data_version" },
    "n_frames": { "type": "integer", "minimum": 0 },
    "epochs": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["epoch_id", "mjd_start", "mjd_end", "mjd_mean", "n_frames", "detectors"],
        "properties": {
          "epoch_id": { "type": "integer", "minimum": 0 },
          "mjd_start": { "$ref": "common.schema.json#/$defs/mjd" },
          "mjd_end": { "$ref": "common.schema.json#/$defs/mjd" },
          "mjd_mean": { "$ref": "common.schema.json#/$defs/mjd" },
          "n_frames": { "type": "integer", "minimum": 1 },
          "detectors": {
            "type": "array",
            "items": { "$ref": "common.schema.json#/$defs/detector" },
            "minItems": 1,
            "uniqueItems": true
          }
        }
      }
    },
    "frames": { "type": "array", "items": { "$ref": "#/$defs/frame" } }
  },
  "$defs": {
    "frame": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "index", "frame_key", "obs_id", "release", "processing_version",
        "detector", "mjd", "obs_time_utc", "epoch_id", "lambda_um",
        "bandwidth_um", "lambda_min_um", "lambda_max_um", "channel",
        "target_ra_deg", "target_dec_deg", "target_x", "target_y",
        "good_fraction", "aperture_pixels", "flag_fractions",
        "contamination_level", "saturated_pixels", "alignment_residual_px",
        "source_uri"
      ],
      "properties": {
        "index": { "type": "integer", "minimum": 0 },
        "frame_key": { "type": "string", "minLength": 1 },
        "obs_id": { "type": "string", "minLength": 1 },
        "release": { "$ref": "common.schema.json#/$defs/release" },
        "processing_version": { "type": ["string", "null"] },
        "detector": { "$ref": "common.schema.json#/$defs/detector" },
        "mjd": { "$ref": "common.schema.json#/$defs/mjd" },
        "obs_time_utc": { "$ref": "common.schema.json#/$defs/iso_utc" },
        "epoch_id": { "type": "integer", "minimum": 0 },
        "lambda_um": { "type": "number", "exclusiveMinimum": 0 },
        "bandwidth_um": { "type": "number", "exclusiveMinimum": 0 },
        "lambda_min_um": { "type": "number", "exclusiveMinimum": 0 },
        "lambda_max_um": { "type": "number", "exclusiveMinimum": 0 },
        "channel": { "$ref": "common.schema.json#/$defs/channel" },
        "target_ra_deg": { "$ref": "common.schema.json#/$defs/ra_deg" },
        "target_dec_deg": { "$ref": "common.schema.json#/$defs/dec_deg" },
        "target_x": { "type": "number" },
        "target_y": { "type": "number" },
        "good_fraction": { "$ref": "common.schema.json#/$defs/fraction" },
        "aperture_pixels": { "type": "integer", "minimum": 0 },
        "flag_fractions": {
          "oneOf": [
            { "$ref": "common.schema.json#/$defs/flag_fractions" },
            { "type": "null" }
          ]
        },
        "contamination_level": { "enum": [0, 1, 2] },
        "saturated_pixels": { "type": "integer", "minimum": 0 },
        "alignment_residual_px": { "type": ["number", "null"], "minimum": 0 },
        "source_uri": { "type": "string", "minLength": 1 }
      }
    }
  }
}
```

### 6.2 Field semantics

| Field | Unit | Definition |
|---|---|---|
| `index` | — | Zero-based position of the frame; also its item index in `frames.bin`. |
| `frame_key` | — | Unique key: file name stem of the L2 file (no directory, no extension). |
| `obs_id` | — | `OBSID` header keyword of the exposure. |
| `processing_version` | — | `VERSION` keyword from the primary header; `null` if absent or empty. |
| `mjd` | d | Observation time from the TAP `time_bounds_lower` column. Ingestion MUST fail the frame if the value is outside 60000–70000. |
| `obs_time_utc` | — | `mjd` rendered as ISO 8601 UTC, rounded to milliseconds. |
| `lambda_um`, `bandwidth_um` | µm | Central wavelength and bandwidth at the pixel of the target's predicted position (spectral WCS key `W`). |
| `lambda_min_um`, `lambda_max_um` | µm | Minimum and maximum wavelength over the valid cutout pixels. |
| `target_ra_deg`, `target_dec_deg` | deg | Target position at `mjd` (§3.1). |
| `target_x`, `target_y` | px | The same position in grid pixels (§3.2). |
| `good_fraction` | — | Fraction of grid pixels whose intensity (plane 0) is finite. |
| `aperture_pixels` | — | Count of native cutout pixels inside the 3-pixel aperture around the target's predicted position that lie within the cutout footprint. |
| `flag_fractions` | — | For each bad bit, the fraction of those aperture pixels with the bit set. `null` when `aperture_pixels == 0`. |
| `contamination_level` | — | §3.6. |
| `saturated_pixels` | — | Count of values clipped to ±65504 when written to `frames.bin` (both planes combined). |
| `alignment_residual_px` | px | RMS offset of up to the 10 brightest common sources relative to their median position across frames of the same detector; `null` when fewer than 3 sources are available. For a pair of frames A and B the client uses `sqrt(rA² + rB²)`; a missing value makes the pair's residual unknown. |
| `source_uri` | — | The IRSA cutout URL used, including `center` and `size` query parameters. |

### 6.3 Invariants

1. `frames` is sorted by `(mjd, detector, frame_key)` ascending; `frames[i].index == i`.
2. `n_frames == len(frames) == meta.observations.n_frames`.
3. `epochs` follows §3.5; `sum(epochs[*].n_frames) == n_frames`; `epochs[*].detectors` is sorted ascending.
4. `lambda_min_um <= lambda_um <= lambda_max_um`.
5. `channel` follows §3.3.

---

## 7. `coadds.json`

### 7.1 Scopes

All coadds are inverse-variance combinations of reprojected frames (`Ī = Σ(Mᵢ·Iᵢ/Vᵢ) / Σ(Mᵢ/Vᵢ)`, `V̄ = 1/Σ(Mᵢ/Vᵢ)`).

| `scope` | Key | Combines | Intended use |
|---|---|---|---|
| `epoch_detector` | `(epoch_id, detector)` | All frames of one detector in one epoch | Temporal blink, temporal difference, per-epoch RGB |
| `detector` | `(detector)` | All frames of one detector across all epochs | Detector RGB (static sky; motion smears) |
| `channel` | `(channel)` | All frames of one channel across all epochs | Equal-channel RGB, feature RGB (static sky; motion smears) |

Fields that are not part of a scope's key are `null`, except that a `channel`-scope entry sets `detector` to the channel's band.

### 7.2 Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://spherex-sky-explorer/schema/v1/coadds.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "slug", "data_version", "n_coadds", "coadds", "rgb_presets"],
  "properties": {
    "schema_version": { "$ref": "common.schema.json#/$defs/schema_version" },
    "slug": { "$ref": "common.schema.json#/$defs/slug" },
    "data_version": { "$ref": "common.schema.json#/$defs/data_version" },
    "n_coadds": { "type": "integer", "minimum": 0 },
    "coadds": { "type": "array", "items": { "$ref": "#/$defs/coadd" } },
    "rgb_presets": {
      "type": "object",
      "additionalProperties": false,
      "required": ["detector_rgb", "equal_channel_rgb", "feature_lines"],
      "properties": {
        "detector_rgb": {
          "oneOf": [
            { "type": "null" },
            {
              "type": "object",
              "additionalProperties": false,
              "required": ["blue", "green", "red", "group_snr", "min_group_snr"],
              "properties": {
                "blue": { "$ref": "#/$defs/detector_group" },
                "green": { "$ref": "#/$defs/detector_group" },
                "red": { "$ref": "#/$defs/detector_group" },
                "group_snr": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": ["blue", "green", "red"],
                  "properties": {
                    "blue": { "type": "number", "minimum": 0 },
                    "green": { "type": "number", "minimum": 0 },
                    "red": { "type": "number", "minimum": 0 }
                  }
                },
                "min_group_snr": { "type": "number", "minimum": 0 }
              }
            }
          ]
        },
        "equal_channel_rgb": {
          "type": "object",
          "additionalProperties": false,
          "required": ["blue_channels", "green_channels", "red_channels"],
          "properties": {
            "blue_channels": { "$ref": "#/$defs/channel_list" },
            "green_channels": { "$ref": "#/$defs/channel_list" },
            "red_channels": { "$ref": "#/$defs/channel_list" }
          }
        },
        "feature_lines": {
          "type": "array",
          "minItems": 8,
          "maxItems": 8,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["name", "lambda_um", "on_channel", "continuum_channels"],
            "properties": {
              "name": { "type": "string" },
              "lambda_um": { "type": "number", "exclusiveMinimum": 0 },
              "on_channel": { "$ref": "common.schema.json#/$defs/channel" },
              "continuum_channels": {
                "type": "array",
                "items": { "$ref": "common.schema.json#/$defs/channel" },
                "minItems": 2,
                "maxItems": 4,
                "uniqueItems": true
              }
            }
          }
        }
      }
    }
  },
  "$defs": {
    "detector_group": {
      "type": "array",
      "items": { "$ref": "common.schema.json#/$defs/detector" },
      "minItems": 1,
      "uniqueItems": true
    },
    "channel_list": {
      "type": "array",
      "items": { "$ref": "common.schema.json#/$defs/channel" },
      "minItems": 1,
      "uniqueItems": true
    },
    "coadd": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "index", "scope", "epoch_id", "detector", "channel", "n_frames",
        "frame_indices", "mjd_min", "mjd_max", "mjd_mean", "lambda_mean_um",
        "lambda_min_um", "lambda_max_um", "snr_target"
      ],
      "properties": {
        "index": { "type": "integer", "minimum": 0 },
        "scope": { "enum": ["epoch_detector", "detector", "channel"] },
        "epoch_id": { "type": ["integer", "null"], "minimum": 0 },
        "detector": { "oneOf": [{ "$ref": "common.schema.json#/$defs/detector" }, { "type": "null" }] },
        "channel": { "oneOf": [{ "$ref": "common.schema.json#/$defs/channel" }, { "type": "null" }] },
        "n_frames": { "type": "integer", "minimum": 1 },
        "frame_indices": {
          "type": "array",
          "items": { "type": "integer", "minimum": 0 },
          "minItems": 1,
          "uniqueItems": true
        },
        "mjd_min": { "$ref": "common.schema.json#/$defs/mjd" },
        "mjd_max": { "$ref": "common.schema.json#/$defs/mjd" },
        "mjd_mean": { "$ref": "common.schema.json#/$defs/mjd" },
        "lambda_mean_um": { "type": "number", "exclusiveMinimum": 0 },
        "lambda_min_um": { "type": "number", "exclusiveMinimum": 0 },
        "lambda_max_um": { "type": "number", "exclusiveMinimum": 0 },
        "snr_target": { "type": ["number", "null"] }
      }
    }
  }
}
```

### 7.3 Semantics and invariants

1. `coadds` is ordered by scope (`epoch_detector`, then `detector`, then `channel`); within a scope by `epoch_id`, `detector`, `channel` ascending. `coadds[i].index == i` and equals the item index in `coadds.bin`.
2. `frame_indices` is sorted ascending and refers to `frames.json` indices; `n_frames == len(frame_indices)`.
3. Key rules: `epoch_detector` → `epoch_id`, `detector` non-null, `channel` null. `detector` → `detector` non-null, `epoch_id` and `channel` null. `channel` → `channel` non-null, `detector` equals `floor(channel / 17) + 1`, `epoch_id` null.
4. `lambda_mean_um` is the unweighted mean of the member frames' `lambda_um`; `lambda_min_um`/`lambda_max_um` are the minimum and maximum of member `lambda_min_um`/`lambda_max_um`.
5. `snr_target = F / σ_F` where, on the coadd grid, `F = Σ I(p) − N · median(I over the annulus 6–10 px)` over the `N` finite pixels within 3 px of the target's grid position at `mjd_mean` (§3.1, §3.2), and `σ_F = sqrt(Σ σ(p)²)` over the same pixels. `null` when `N == 0` or the annulus has no finite pixels.
6. `rgb_presets.detector_rgb`: among the contiguous partitions of the ordered detector list `[1,2,3,4,5,6]` into three non-empty groups (blue lowest wavelengths, red highest), choose the one maximizing `min_group_snr`. A group's SNR is `sqrt(Σ snr²)` over its detectors using each detector's `scope == "detector"` `snr_target` (`null` counts as 0; negative values count as 0). `null` when fewer than three `detector`-scope coadds exist. Ties resolve to the partition with the smaller blue group, then the smaller green group.
7. `rgb_presets.equal_channel_rgb` is constant in v1:
   - `blue_channels = [0, 1, …, 32]`
   - `green_channels = [33, 34, …, 49] ∪ [52, 53, …, 67]`
   - `red_channels = [68, 69, …, 101]`
8. `rgb_presets.feature_lines` lists the eight entries of `meta.processing.line_markers` in the same order and with the same `name`/`lambda_um`. `on_channel` is the valid channel (any channel except 50 and 51) whose `lambda_um` is nearest to the line. `continuum_channels` are the two valid channels immediately below and the two immediately above `on_channel` in valid-channel order, clipped at the ends (2–4 entries).

---

## 8. `sed.json`

One point per frame, in frame order. Photometry is measured on the **native** cutout pixels (before reprojection) at the target's predicted pixel position; centroids are measured on the reprojected grid (plane 0).

### 8.1 Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://spherex-sky-explorer/schema/v1/sed.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version", "slug", "data_version", "flux_unit", "wavelength_unit",
    "aperture_radii_px", "primary_aperture_index", "annulus_px",
    "solid_angle_source", "nominal_pixel_sr", "n_points", "points"
  ],
  "properties": {
    "schema_version": { "$ref": "common.schema.json#/$defs/schema_version" },
    "slug": { "$ref": "common.schema.json#/$defs/slug" },
    "data_version": { "$ref": "common.schema.json#/$defs/data_version" },
    "flux_unit": { "const": "mJy" },
    "wavelength_unit": { "const": "um" },
    "aperture_radii_px": { "const": [3, 4, 5] },
    "primary_aperture_index": { "const": 0 },
    "annulus_px": { "const": [6, 10] },
    "solid_angle_source": { "enum": ["sapm", "nominal_pixel"] },
    "nominal_pixel_sr": { "const": 8.8897e-10 },
    "n_points": { "type": "integer", "minimum": 0 },
    "points": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "frame_index", "epoch_id", "detector", "channel", "mjd",
          "obs_time_utc", "lambda_um", "bandwidth_um", "flux_mjy",
          "flux_err_mjy", "flagged", "centroid_x", "centroid_y", "centroid_err_px"
        ],
        "properties": {
          "frame_index": { "type": "integer", "minimum": 0 },
          "epoch_id": { "type": "integer", "minimum": 0 },
          "detector": { "$ref": "common.schema.json#/$defs/detector" },
          "channel": { "$ref": "common.schema.json#/$defs/channel" },
          "mjd": { "$ref": "common.schema.json#/$defs/mjd" },
          "obs_time_utc": { "$ref": "common.schema.json#/$defs/iso_utc" },
          "lambda_um": { "type": "number", "exclusiveMinimum": 0 },
          "bandwidth_um": { "type": "number", "exclusiveMinimum": 0 },
          "flux_mjy": { "$ref": "common.schema.json#/$defs/triple_nullable_number" },
          "flux_err_mjy": { "$ref": "common.schema.json#/$defs/triple_nullable_number" },
          "flagged": { "type": "boolean" },
          "centroid_x": { "type": ["number", "null"] },
          "centroid_y": { "type": ["number", "null"] },
          "centroid_err_px": { "type": ["number", "null"], "minimum": 0 }
        }
      }
    }
  }
}
```

### 8.2 Semantics and invariants

1. `points[i].frame_index == i`; `n_points == frames.json.n_frames`. Fields `epoch_id`, `detector`, `channel`, `mjd`, `obs_time_utc`, `lambda_um`, `bandwidth_um` equal the values of `frames[i]`.
2. `flux_mjy[k]` and `flux_err_mjy[k]` correspond to `aperture_radii_px[k]`. Flux is the background-subtracted aperture sum of `IMAGE − ZODI` converted from MJy/sr to mJy with the per-pixel solid angle (`solid_angle_source = "sapm"`, the per-detector solid-angle pixel map) or `nominal_pixel_sr` per pixel (`"nominal_pixel"`). The background is the sigma-clipped mean of the annulus `annulus_px`, scaled to the aperture area. `flux_err_mjy[k] = sqrt(Σ VARIANCE over the aperture) × solid angle` combined in quadrature with the annulus-mean uncertainty.
3. `flux_mjy[k]` and `flux_err_mjy[k]` are `null` when the aperture contains no valid pixel or the annulus contains no valid pixel; they are `null` together.
4. `flagged = (frames[i].contamination_level != 0)`.
5. `centroid_x`, `centroid_y` are grid pixel coordinates (§3.2) of the photutils centroid of the grid frame within 3 px of `target_x`, `target_y`; `centroid_err_px` is its 1σ uncertainty. All three are `null` together when the centroid fit fails or the 3-pixel window has no valid pixels.

---

## 9. `gaia.json`

### 9.1 Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://spherex-sky-explorer/schema/v1/gaia.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version", "slug", "data_version", "query_status", "query",
    "match_radius_arcsec", "n_sources_in_cone", "verdict", "verdict_detail",
    "primary_source_id", "measured_pm", "consistency", "sources"
  ],
  "properties": {
    "schema_version": { "$ref": "common.schema.json#/$defs/schema_version" },
    "slug": { "$ref": "common.schema.json#/$defs/slug" },
    "data_version": { "$ref": "common.schema.json#/$defs/data_version" },
    "query_status": { "enum": ["ok", "unavailable"] },
    "query": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "endpoint", "table", "center_ra_deg", "center_dec_deg",
        "radius_arcsec", "executed_utc", "adql"
      ],
      "properties": {
        "endpoint": { "const": "https://gea.esac.esa.int/tap-server/tap" },
        "table": { "const": "gaiadr3.gaia_source" },
        "center_ra_deg": { "$ref": "common.schema.json#/$defs/ra_deg" },
        "center_dec_deg": { "$ref": "common.schema.json#/$defs/dec_deg" },
        "radius_arcsec": { "type": "number", "exclusiveMinimum": 0 },
        "executed_utc": { "$ref": "common.schema.json#/$defs/iso_utc" },
        "adql": { "type": "string", "minLength": 1 }
      }
    },
    "match_radius_arcsec": { "const": 10 },
    "n_sources_in_cone": { "type": "integer", "minimum": 0 },
    "verdict": {
      "enum": ["match_consistent", "match_inconsistent", "no_counterpart", "unavailable"]
    },
    "verdict_detail": { "type": "string", "maxLength": 400 },
    "primary_source_id": { "type": ["string", "null"], "pattern": "^[0-9]{1,19}$" },
    "measured_pm": {
      "oneOf": [
        { "type": "null" },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "pmra_mas_yr", "pmdec_mas_yr", "pmra_err_mas_yr", "pmdec_err_mas_yr",
            "n_frames_used", "n_epochs_used", "baseline_days", "method"
          ],
          "properties": {
            "pmra_mas_yr": { "type": "number" },
            "pmdec_mas_yr": { "type": "number" },
            "pmra_err_mas_yr": { "type": "number", "minimum": 0 },
            "pmdec_err_mas_yr": { "type": "number", "minimum": 0 },
            "n_frames_used": { "type": "integer", "minimum": 1 },
            "n_epochs_used": { "type": "integer", "minimum": 3 },
            "baseline_days": { "type": "number", "minimum": 300 },
            "method": { "const": "weighted_linear_centroid" }
          }
        }
      ]
    },
    "consistency": {
      "oneOf": [
        { "type": "null" },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "delta_pmra_mas_yr", "delta_pmdec_mas_yr",
            "sigma_combined_mas_yr", "within_3_sigma"
          ],
          "properties": {
            "delta_pmra_mas_yr": { "type": "number" },
            "delta_pmdec_mas_yr": { "type": "number" },
            "sigma_combined_mas_yr": { "type": "number", "minimum": 0 },
            "within_3_sigma": { "type": "boolean" }
          }
        }
      ]
    },
    "sources": { "type": "array", "items": { "$ref": "#/$defs/gaia_source" } }
  },
  "$defs": {
    "gaia_source": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "source_id", "ra_deg", "dec_deg", "ref_epoch_year", "pmra_mas_yr",
        "pmdec_mas_yr", "parallax_mas", "parallax_error_mas",
        "phot_g_mean_mag", "separation_arcsec", "is_primary", "predicted_track"
      ],
      "properties": {
        "source_id": { "type": "string", "pattern": "^[0-9]{1,19}$" },
        "ra_deg": { "$ref": "common.schema.json#/$defs/ra_deg" },
        "dec_deg": { "$ref": "common.schema.json#/$defs/dec_deg" },
        "ref_epoch_year": { "type": "number" },
        "pmra_mas_yr": { "type": ["number", "null"] },
        "pmdec_mas_yr": { "type": ["number", "null"] },
        "parallax_mas": { "type": ["number", "null"] },
        "parallax_error_mas": { "type": ["number", "null"], "minimum": 0 },
        "phot_g_mean_mag": { "type": ["number", "null"] },
        "separation_arcsec": { "type": "number", "minimum": 0 },
        "is_primary": { "type": "boolean" },
        "predicted_track": {
          "oneOf": [
            { "type": "null" },
            {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["epoch_id", "mjd", "ra_deg", "dec_deg", "x", "y"],
                "properties": {
                  "epoch_id": { "type": "integer", "minimum": 0 },
                  "mjd": { "$ref": "common.schema.json#/$defs/mjd" },
                  "ra_deg": { "$ref": "common.schema.json#/$defs/ra_deg" },
                  "dec_deg": { "$ref": "common.schema.json#/$defs/dec_deg" },
                  "x": { "type": "number" },
                  "y": { "type": "number" }
                }
              }
            }
          ]
        }
      }
    }
  }
}
```

### 9.2 Semantics and invariants

1. **Query.** `adql` is a cone search on `gaiadr3.gaia_source` selecting `source_id, ra, dec, ref_epoch, pmra, pmdec, parallax, parallax_error, phot_g_mean_mag`. `radius_arcsec` is `10` for static targets and `|μ|·Δt + 10` for targets with proper motion, where `|μ|` is the total proper motion in arcsec/yr and `Δt` is the number of years between `target.coord_epoch_year` and the Gaia reference epoch (floor of 0). The cone centre is `(target.input_ra_deg, target.input_dec_deg)`.
2. **Sources.** `sources` lists every returned source sorted by `separation_arcsec` ascending. `separation_arcsec` is the angular distance between the source propagated to `meta.center.t_mid_mjd` (using its own `pmra`/`pmdec`, zero motion when `null`) and `meta.center`. `ref_epoch_year` is Gaia's `ref_epoch` column. `n_sources_in_cone == len(sources)`.
3. **Primary.** `primary_source_id` is the `source_id` of the first source with `separation_arcsec <= match_radius_arcsec`, or `null`. Exactly that source has `is_primary = true`.
4. **Predicted track.** For the primary source only, one entry per epoch (`mjd` is `epoch.mjd_mean`) with the propagated position and grid pixel (§3.2). All other sources have `predicted_track = null`.
5. **Measured proper motion.** `measured_pm` is the weighted linear fit of `centroid_x`, `centroid_y` versus time (converted to `ra_deg`, `dec_deg` through §3.2) over frames with non-null centroids and `contamination_level != 2`. It is `null` when fewer than `processing.pm_fit_min_epochs` distinct epochs contribute or the time span is shorter than `processing.pm_fit_min_baseline_days`.
6. **Consistency.** `consistency` is non-null if and only if `measured_pm` is non-null and the primary source has non-null `pmra_mas_yr` and `pmdec_mas_yr`. `delta_* = measured − Gaia`; `sigma_combined_mas_yr = sqrt(σ_meas² + σ_Gaia²)` evaluated on the larger of the RA and Dec components (a missing Gaia error is treated as 0); `within_3_sigma = hypot(delta_pmra, delta_pmdec) <= 3 · sigma_combined_mas_yr`.
7. **Verdict.**

| `verdict` | Condition |
|---|---|
| `unavailable` | `query_status == "unavailable"` |
| `no_counterpart` | `query_status == "ok"` and `primary_source_id == null` |
| `match_inconsistent` | primary exists and `consistency != null` and `consistency.within_3_sigma == false` |
| `match_consistent` | primary exists and (`consistency == null` or `consistency.within_3_sigma == true`) |

8. When `query_status == "unavailable"`: `sources = []`, `n_sources_in_cone = 0`, `primary_source_id = null`, `measured_pm = null`, `consistency = null`, `verdict = "unavailable"`.
9. `verdict_detail` is a single human-readable sentence stating which rule produced the verdict.

---

## 10. Binary files

### 10.1 `frames.bin`

| Property | Value |
|---|---|
| Content | Raw array, no header, no padding, no compression |
| Element type | IEEE 754 binary16 (half precision) |
| Byte order | **Little-endian** |
| Axes | `[item, plane, y, x]`, C-order (`x` varies fastest) |
| `item` | Frame index (`frames.json` `index`) |
| `plane` | `0 = intensity` (MJy/sr), `1 = sigma` (MJy/sr, 1σ of plane 0) |
| `y`, `x` | §3.2 (`y = 0` southernmost row, `x = 0` easternmost column) |
| Total size | `N × 2 × H × W × 2` bytes |

**Byte offset of element `(f, p, y, x)`:**

```
offset = ((((f * 2 + p) * H + y) * W + x) * 2
```

**Content of the planes.** Plane 0 is the calibrated, masked, reprojected intensity `I′ = IMAGE − ZODI − B` on the common grid. Plane 1 is the 1σ uncertainty (`sqrt(VARIANCE)` carried through the reprojection). Pixels that are masked (`(flags & 712439) != 0`), outside the footprint, or otherwise invalid are NaN in plane 0 and NaN in plane 1 at the same position. A pixel is NaN in plane 1 if and only if it is NaN in plane 0.

**Special values.**

| Value | Encoding (hex, 16-bit value) | Bytes on disk (little-endian) |
|---|---|---|
| NaN (writer default) | `0x7E00` | `00 7E` |
| +1.0 | `0x3C00` | `00 3C` |
| −1.0 | `0xBC00` | `00 BC` |
| +0.5 | `0x3800` | `00 38` |
| +2.0 | `0x4000` | `00 40` |
| +65504 (max finite) | `0x7BFF` | `FF 7B` |
| −65504 | `0xFBFF` | `FF FB` |
| +0.0 | `0x0000` | `00 00` |

Readers treat any value with an all-ones exponent and non-zero mantissa as NaN. Writers MUST NOT emit ±Infinity: values with magnitude above 65504 are clipped to ±65504 and counted in `frames[i].saturated_pixels`. Round-to-nearest-even is used when converting from float32/float64.

**Reading in Python:**

```python
import numpy as np
a = np.fromfile("frames.bin", dtype="<f2").reshape(N, 2, H, W)   # [item, plane, y, x]
intensity, sigma = a[:, 0], a[:, 1]
```

**Reading in the browser:**

```js
function halfToFloat(h) {                       // h: uint16
  const s = (h & 0x8000) ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x03ff;
  if (e === 0) return s * Math.pow(2, -14) * (m / 1024);
  if (e === 0x1f) return m ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + m / 1024);
}

function readPixel(view /* DataView over frames.bin */, W, H, f, p, y, x) {
  const offset = ((((f * 2 + p) * H + y) * W + x)) * 2;
  return halfToFloat(view.getUint16(offset, /* littleEndian */ true));
}
```

Consumers MUST verify `byteLength == meta.binaries.frames.bytes` before decoding and MUST reject the file otherwise.

### 10.2 `coadds.bin`

Identical layout to `frames.bin` with `item` = coadd index (`coadds.json` `index`). Plane 0 is `Ī` (MJy/sr); plane 1 is `sqrt(V̄)` (MJy/sr). NaN rules, special values, offset formula, and clipping rules are the same. Total size is `n_coadds × 2 × H × W × 2` bytes and equals `meta.binaries.coadds.bytes`. When `n_coadds == 0` the file exists with size 0.

### 10.3 Verification vectors

A conforming implementation decodes the 16 bytes `00 3C 00 BC 00 7E FF 7B FF FB 00 00 00 38 00 40` (read as eight little-endian uint16 values) to `[1.0, -1.0, NaN, 65504, -65504, 0.0, 0.5, 2.0]`.

---

## 11. `POST /api/jobs`

Creates (or joins, or serves from cache) a Tier 2 job for a coordinate. The response contains no scientific data; data are read from `/data/{slug}/`.

### 11.1 Request

`Content-Type: application/json`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://spherex-sky-explorer/schema/v1/job_request.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["ra_deg", "dec_deg"],
  "properties": {
    "ra_deg": { "$ref": "common.schema.json#/$defs/ra_deg" },
    "dec_deg": { "$ref": "common.schema.json#/$defs/dec_deg" },
    "size_deg": { "$ref": "common.schema.json#/$defs/size_deg", "default": 0.1 },
    "name": { "type": ["string", "null"], "maxLength": 120, "default": null },
    "pmra_mas_yr": { "type": ["number", "null"], "default": null },
    "pmdec_mas_yr": { "type": ["number", "null"], "default": null },
    "coord_epoch_year": { "type": ["number", "null"], "minimum": 1900, "maximum": 2100, "default": null },
    "force_refresh": { "type": "boolean", "default": false }
  }
}
```

Example:

```json
{ "ra_deg": 210.80227, "dec_deg": 54.34895, "size_deg": 0.1 }
```

### 11.2 Normalization and validation

1. Defaults are applied; `ra_deg` and `dec_deg` are rounded to 6 decimals.
2. `pmra_mas_yr` and `pmdec_mas_yr` are both `null` or both numbers; otherwise `422`.
3. `coord_epoch_year = null` is normalized to `2000.0` and recorded with `coord_epoch_assumed = true` in `meta.json`; a supplied value gives `coord_epoch_assumed = false`.
4. `pm_source` in the result is `"user"` when both proper motions are supplied, otherwise `"gaia_dr3"` if the primary Gaia match supplies proper motions, otherwise `"none"`.

### 11.3 Identity

```
request_key = "{ra:.6f}|{dec:.6f}|{size:.2f}|{pmra|none}|{pmdec|none}|{epoch:.2f}"
slug        = "c-" + sha256(utf8(request_key)).hexdigest()[:16]
job_id      = "j_" + 16 lowercase hex characters (random)
```

`pmra|none` renders the number with the shortest round-trip form, or the literal `none`. A complete result is served from cache when `/data/{slug}/meta.json` exists with `status = "complete"` and age below `cache_ttl_hours` (server config, default 24), unless `force_refresh` is `true`.

### 11.4 Responses

**`202 Accepted`** — a new job was queued, or the request joined a queued/running job with the same `slug`.
**`200 OK`** — a cached complete result exists (`cached = true`).

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://spherex-sky-explorer/schema/v1/job_response.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "job_id", "slug", "status", "cached", "joined", "created_utc",
    "events_url", "data_base_url", "request"
  ],
  "properties": {
    "job_id": { "type": "string", "pattern": "^j_[0-9a-f]{16}$" },
    "slug": { "$ref": "common.schema.json#/$defs/slug" },
    "status": { "enum": ["queued", "running", "complete"] },
    "cached": { "type": "boolean" },
    "joined": { "type": "boolean" },
    "created_utc": { "$ref": "common.schema.json#/$defs/iso_utc" },
    "events_url": { "type": "string" },
    "data_base_url": { "type": "string" },
    "request": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "ra_deg", "dec_deg", "size_deg", "name", "pmra_mas_yr", "pmdec_mas_yr",
        "coord_epoch_year", "coord_epoch_assumed", "force_refresh"
      ],
      "properties": {
        "ra_deg": { "$ref": "common.schema.json#/$defs/ra_deg" },
        "dec_deg": { "$ref": "common.schema.json#/$defs/dec_deg" },
        "size_deg": { "$ref": "common.schema.json#/$defs/size_deg" },
        "name": { "type": ["string", "null"] },
        "pmra_mas_yr": { "type": ["number", "null"] },
        "pmdec_mas_yr": { "type": ["number", "null"] },
        "coord_epoch_year": { "type": "number" },
        "coord_epoch_assumed": { "type": "boolean" },
        "force_refresh": { "type": "boolean" }
      }
    }
  }
}
```

Rules: `status = "complete"` if and only if `cached = true`. `joined = true` only when attached to an in-flight job. A cached response returns the `job_id` of the job that produced the result, and `events_url` replays that job's terminal events.

Example (`202`):

```json
{
  "job_id": "j_3f9a1c07b2d4e581",
  "slug": "c-8e21b4d0a97c3f56",
  "status": "queued",
  "cached": false,
  "joined": false,
  "created_utc": "2026-11-15T10:02:11.482Z",
  "events_url": "/api/jobs/j_3f9a1c07b2d4e581/events",
  "data_base_url": "/data/c-8e21b4d0a97c3f56/",
  "request": {
    "ra_deg": 210.80227,
    "dec_deg": 54.34895,
    "size_deg": 0.1,
    "name": null,
    "pmra_mas_yr": null,
    "pmdec_mas_yr": null,
    "coord_epoch_year": 2000.0,
    "coord_epoch_assumed": true,
    "force_refresh": false
  }
}
```

### 11.5 Errors

All error responses use `Content-Type: application/json`:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Request validation failed.",
    "details": [{ "field": "size_deg", "issue": "must be one of 0.05, 0.1, 0.2" }]
  }
}
```

| HTTP | `error.code` | Condition | Extra |
|---|---|---|---|
| 400 | `malformed_json` | Body is not valid JSON | — |
| 415 | `unsupported_media_type` | `Content-Type` is not `application/json` | — |
| 422 | `invalid_request` | Schema or cross-field validation failed (§11.2) | `details[]` lists `{field, issue}` |
| 429 | `queue_full` | Job queue at capacity | `Retry-After: <seconds>` header |
| 500 | `internal_error` | Unexpected server failure | — |

`details` is an array of `{ "field": string, "issue": string }` and is `[]` for codes without field-level detail.

---

## 12. `GET /api/jobs/{job_id}/events` (Server-Sent Events)

### 12.1 Transport

| Property | Value |
|---|---|
| Request headers | `Accept: text/event-stream`; optional `Last-Event-ID: <integer>` |
| Response | `200 OK`, `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache` |
| Unknown `job_id` | `404` with the error envelope of §11.5, `error.code = "not_found"` |
| Frame format | `id: <seq>\nevent: <type>\ndata: <one-line JSON>\n\n` |
| `id` | Integer sequence starting at `1`, strictly increasing within a job |
| Retry hint | The first message of each connection is `retry: 3000\n\n` |
| Keep-alive | A comment line `: keepalive\n\n` every 15 seconds |
| Resume | With `Last-Event-ID: n`, the server replays every event with `id > n`, then continues live |
| Replay window | Events are retained for 24 hours after the terminal event |
| Termination | The server closes the stream after sending `complete` or `failed` |

`data` is a single line of UTF-8 JSON with no raw newlines. Every payload contains `job_id`.

### 12.2 Event order

```
job_state(queued) → job_state(running)
→ stage(discover, started) → discovery → stage(discover, finished)
→ stage(fetch_process, started)
→ { progress | frame | warning }*
→ stage(fetch_process, finished)
→ stage(aggregate, started) → stage(aggregate, finished)
→ stage(gaia, started) → stage(gaia, finished)
→ stage(export, started) → stage(export, finished)
→ complete
```

`failed` may replace any event after `job_state(queued)` and ends the stream. For a cached job the stream contains `job_state` (`complete`) followed by `complete`.

### 12.3 Event types

#### `job_state`

| Field | Type | Notes |
|---|---|---|
| `job_id` | string | |
| `status` | `"queued"` \| `"running"` \| `"complete"` \| `"failed"` | |
| `queue_position` | integer \| null | 1-based; non-null only when `status == "queued"` |
| `timestamp_utc` | iso_utc | |

```
id: 1
event: job_state
data: {"job_id":"j_3f9a1c07b2d4e581","status":"queued","queue_position":1,"timestamp_utc":"2026-11-15T10:02:11.482Z"}
```

#### `stage`

| Field | Type | Notes |
|---|---|---|
| `job_id` | string | |
| `stage` | `"discover"` \| `"fetch_process"` \| `"aggregate"` \| `"gaia"` \| `"export"` | |
| `state` | `"started"` \| `"finished"` | |
| `elapsed_s` | number | Seconds since the job started running |

#### `discovery`

| Field | Type | Notes |
|---|---|---|
| `job_id` | string | |
| `n_exposures_found` | integer | Rows returned by the TAP query |
| `n_exposures` | integer | After release filtering and de-duplication; the number of frames to fetch |
| `releases` | object | Keys `"dr1"`, `"qr3"` → integer counts of `n_exposures` |
| `detectors` | object | Keys `"1"`…`"6"` → integer counts of `n_exposures` |
| `tap_elapsed_s` | number | |

When `n_exposures == 0` the job ends with `failed` (`no_coverage`).

#### `progress`

Sent at most four times per second during `fetch_process`.

| Field | Type | Notes |
|---|---|---|
| `job_id` | string | |
| `stage` | `"fetch_process"` | |
| `total` | integer | Equals `discovery.n_exposures` |
| `done` | integer | Frames fetched and processed |
| `failed` | integer | Frames that exhausted their retries |
| `elapsed_s` | number | |

```
id: 14
event: progress
data: {"job_id":"j_3f9a1c07b2d4e581","stage":"fetch_process","total":415,"done":88,"failed":2,"elapsed_s":19.4}
```

#### `frame`

A processed frame, in completion order (not time order). The canonical order and indices are defined by `frames.json` after `complete`.

| Field | Type | Notes |
|---|---|---|
| `job_id` | string | |
| `seq_frame` | integer | Arrival counter starting at 1 |
| `frame` | object | The `frames.json` frame object **without** `index` and `epoch_id` (both assigned at export) |
| `pixels` | object | See below |

`pixels`:

| Field | Type | Value |
|---|---|---|
| `encoding` | string | `"base64"` |
| `dtype` | string | `"float16"` |
| `byte_order` | string | `"little"` |
| `axes` | array | `["plane","y","x"]` |
| `shape` | array | `[2, H, W]` (`H`, `W` from `meta.grid`) |
| `data` | string | Base64 of `2 × H × W × 2` bytes laid out exactly as one `item` of `frames.bin` (§10.1) |

The grid geometry used by `frame` events equals the final `meta.grid` (it is derived from the request and the discovered exposures before any frame is emitted, and `center` does not change after the `discovery` event).

#### `warning`

| Field | Type | Notes |
|---|---|---|
| `job_id` | string | |
| `code` | `"fetch_retry"` \| `"fetch_failed"` \| `"wavelength_gradient"` \| `"gaia_unavailable"` | |
| `message` | string | |
| `context` | object \| null | `fetch_retry`/`fetch_failed`: `{ "source_uri": string, "attempt": integer }`; `wavelength_gradient`: `{ "max_span_um": number, "min_bandwidth_um": number }`; `gaia_unavailable`: `null` |

`wavelength_gradient` is sent once when `lambda_max_um − lambda_min_um` of any frame exceeds that frame's `bandwidth_um`. `fetch_failed` is sent when a frame is dropped after its retries; the final backfill pass (before `stage(fetch_process, finished)`) retries all dropped frames once more.

#### `complete`

| Field | Type | Notes |
|---|---|---|
| `job_id` | string | |
| `slug` | string | |
| `result_status` | `"complete"` \| `"partial"` | Equals `meta.status` |
| `data_base_url` | string | `/data/{slug}/` |
| `data_version` | data_version | |
| `n_frames` | integer | |
| `n_epochs` | integer | |
| `n_failed_fetches` | integer | |
| `files` | object | The `meta.files` object plus an entry `"meta.json"` with `{bytes, sha256}` |
| `elapsed_s` | number | |

```
id: 213
event: complete
data: {"job_id":"j_3f9a1c07b2d4e581","slug":"c-8e21b4d0a97c3f56","result_status":"complete","data_base_url":"/data/c-8e21b4d0a97c3f56/","data_version":"sha256:00000000000000000000000000000000000000000000000000000000000000aa","n_frames":413,"n_epochs":7,"n_failed_fetches":0,"files":{"meta.json":{"bytes":18234,"sha256":"00000000000000000000000000000000000000000000000000000000000000bb"}},"elapsed_s":96.3}
```

(The `files` object in a real event contains all seven entries.)

#### `failed`

| Field | Type | Notes |
|---|---|---|
| `job_id` | string | |
| `code` | `"no_coverage"` \| `"upstream_unavailable"` \| `"timeout"` \| `"internal_error"` | |
| `message` | string | |
| `retryable` | boolean | `true` for `upstream_unavailable` and `timeout` |
| `elapsed_s` | number | |

```
id: 5
event: failed
data: {"job_id":"j_3f9a1c07b2d4e581","code":"no_coverage","message":"No SPHEREx exposures overlap this position in the configured releases.","retryable":false,"elapsed_s":22.1}
```

### 12.4 Client obligations

1. After `complete`, the client loads `meta.json`, `frames.json`, `frames.bin`, `coadds.json`, `coadds.bin`, `sed.json` and `gaia.json` from `data_base_url` and verifies each file's `bytes` and `sha256` against `complete.files`.
2. The canonical frame order and `index` values come from `frames.json`; streamed `frame` events are matched to canonical frames by `frame.frame_key`.
3. A client that reconnects sends `Last-Event-ID` with the last `id` it processed.

---

## 13. HTTP serving of `/data/{slug}/`

| Property | Rule |
|---|---|
| Methods | `GET`, `HEAD` |
| `Content-Type` | `.json` → `application/json`; `.bin` → `application/octet-stream`; `.png` → `image/png` |
| Integrity | `ETag` equals `"{sha256}"` of the file bytes |
| Caching | `Cache-Control: public, max-age=31536000, immutable` when the request carries `?v=<data_version>`; otherwise `Cache-Control: no-cache` |
| Compression | JSON MAY be served with `Content-Encoding: gzip`; `.bin` and `.png` are served as stored |
| Length | `Content-Length` is always present for `.bin` files |
| Missing | `404` with the error envelope, `error.code = "not_found"` |
| Visibility | A directory without `meta.json` returns `404` for every file |

---

## 14. Producer checklist

A result directory is valid when all of the following hold:

1. Every JSON file validates against its schema in §§4–9 and carries `schema_version = "1.0.0"`, `slug` equal to the directory name, and the same `data_version` as `meta.json`.
2. All invariants in §5.3, §6.3, §7.3, §8.2 and §9.2 hold.
3. `frames.bin` and `coadds.bin` byte lengths equal `meta.binaries.*.bytes`, and every NaN in plane 0 is NaN in plane 1 at the same offset and vice versa.
4. Every file's SHA-256 matches `meta.files`.
5. `meta.json` was written last.

## 15. Change policy

Any change to a field name, type, unit, axis order, byte order, NaN rule, scope definition, verdict rule or SSE event shape requires a version bump recorded in `schema_version` and in the title line of this file.
