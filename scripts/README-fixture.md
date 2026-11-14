# Synthetic fixture choices

`scripts/make-fixture.mjs` writes `public/data/fixture-barnard/`. Where `DATA_CONTRACT.md` allows more than one valid value, the generator uses the simplest one:

- `tier` is `tier1`. The slug `fixture-barnard` is not one of the published slugs in §2.1; those tables name real targets. `tier1` is the Barnard's Star analogue.
- `input_ra_deg` and `input_dec_deg` are back-solved so `center` at `t_mid_mjd` is exactly RA 269.452, Dec +4.693 (§3.1). `coord_epoch_year` is 2016, `coord_epoch_assumed` is false, `pm_source` is `gaia_dr3`, `pm_reference` is `gaiadr3.gaia_source`, and `parallax_mas` is 547. Proper motion is exactly pmra −803, pmdec +10362 mas/yr.
- `created_utc` and the Gaia `executed_utc` are the fixed instant `2026-11-14T00:00:00.000Z`. Nothing reads the clock.
- Channel wavelengths are synthetic. Each of the six bands is split into 17 equal steps between the edges 0.75, 1.11, 1.64, 2.42, 3.82, 4.42, and 5.0 µm. `bandwidth_um` is that step and is never null. A frame's `lambda_um` is exactly its channel wavelength, so nearest-channel ties do not arise.
- Epoch MJDs are 60400.0, 60400.5, 60410.0, 60410.5, then 60450.0 through 60460.5, then 60580.0 through 60590.5. Gaps inside an epoch are under 30 days; gaps between epochs are over 30 days; the baseline is 190.5 days.
- `aperture_pixels` is 28 on every frame. There is no native cutout, so this is a positive stand-in that keeps `flag_fractions` non-null. Level 1 is `HOT = 0.1`. Level 2 is `OUTLIER = 0.3`. One edge pixel at `(x, y) = (1, 1)` on one frame is set above 65504 so `saturated_pixels` is 1. That pixel is not the moving blob.
- NaN pixels, in both planes, are the four corners and the middle southern-edge pixel `(15, 0)`, encoded as `0x7E00`.
- `solid_angle_source` is `nominal_pixel`. SED fluxes are synthetic mJy values, not a native-aperture measurement. One point nulls all three flux/error pairs together. A different point nulls all three centroid fields together.
- Inverse-variance coadds are computed from the float16 values stored in `frames.bin`. The SNR annulus is `6 <= r <= 10` pixels from the target at the coadd `mjd_mean` (inclusive). The aperture is `r <= 3`. An even-count median is the mean of the two central samples. `snr_target` is measured on the float16 coadd.
- `reprojection` is `interp`. `pipeline_version` is `1.0.0`. `status` is `complete` because `n_failed_fetches` is 0.
- Gaia `ref_epoch_year` is 2016, the same as `coord_epoch_year`, so the cone radius is 10 arcsec (§9.2). `measured_pm` and `consistency` are null because the baseline is under 300 days, which yields `match_consistent`.
- PNG previews are 30×30 8-bit RGB, north-up (row 0 is the northern binary row). `thumb.png` is a grayscale stretch of frame 0. `rgb_equal_channel.png` puts frames 2, 1, and 0 into R, G, and B. Previews are not entries of `meta.files`. `rgb_detector.png` is omitted because only two detectors exist.
- `data_version` hashes the sorted, de-duplicated `source_uri` values joined by `\n` with no trailing newline.
- JSON is UTF-8, LF, two-space indent, and a trailing newline. Numbers use `JSON.stringify` (shortest round-trip). `1.0` is therefore written as `1`.
- Background texture uses mulberry32 seeded with `0x5eedf2`. It is not `Math.random`.
