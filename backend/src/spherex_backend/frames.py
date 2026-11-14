"""Per-frame processing (BACKEND_SPEC section 6.4.4)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from spherex_backend import binfmt, calibrate, centroid, channels, photometry, reproject_step
from spherex_backend.config import Settings
from spherex_backend.grid import Grid
from spherex_backend.models import Exposure, Target
from spherex_backend.parse import InvalidCutout, parse_cutout, wavelength_at
from spherex_backend.timeutil import mjd_to_iso_utc, propagate


@dataclass
class FrameResult:
    frame: dict[str, Any]  # all frames.json fields except `index` and `epoch_id`
    packed: bytes
    phot: photometry.PhotResult
    centroid: tuple[float | None, float | None, float | None]
    intensity: np.ndarray  # float32 (H, W)
    sigma: np.ndarray
    good_fraction: float
    wavelength_span_um: float


def contamination_level(
    aperture_pixels: int, fractions: dict[str, float] | None, severe_fraction: float
) -> int:
    """DATA_CONTRACT section 3.6."""
    if aperture_pixels == 0 or fractions is None:
        return 2
    peak = max(fractions.values(), default=0.0)
    if peak >= severe_fraction:
        return 2
    return 0 if peak == 0 else 1


def process_frame(
    path: Path,
    exposure: Exposure,
    target: Target,
    grid: Grid,
    settings: Settings,
    frame_index_seed: int,
    job_seed: int = 0,
) -> FrameResult:
    cfg = settings.processing
    parsed = parse_cutout(path)

    ra_t, dec_t = propagate(target, exposure.mjd)
    xn, yn = (float(v) for v in parsed.wcs.world_to_pixel_values(ra_t, dec_t))
    target_x, target_y = grid.world_to_pixel(ra_t, dec_t)

    # Wavelength at the predicted pixel and over the valid native pixels.
    lam_arr, bw_arr = wavelength_at(parsed, xn, yn)
    lam, bandwidth = float(lam_arr), float(bw_arr)
    if not (math.isfinite(lam) and math.isfinite(bandwidth) and lam > 0 and bandwidth > 0):
        raise InvalidCutout("invalid cutout: no wavelength at the target position")

    cal = calibrate.calibrate(parsed.image, parsed.zodi, parsed.variance, parsed.flags, xn, yn, cfg)

    ys, xs = np.indices(parsed.image.shape)
    good = ~cal.bad
    lam_min, lam_max = lam, lam
    if good.any():
        lam_all, _ = wavelength_at(parsed, xs[good].astype(float), ys[good].astype(float))
        lam_all = lam_all[np.isfinite(lam_all) & (lam_all > 0)]
        if lam_all.size:
            lam_min, lam_max = min(lam, float(lam_all.min())), max(lam, float(lam_all.max()))

    # Aperture flag statistics on native pixels.
    in_aperture = np.hypot(xs - xn, ys - yn) <= cfg.aperture_radius_px
    aperture_pixels = int(in_aperture.sum())
    fractions: dict[str, float] | None = None
    if aperture_pixels:
        flags_in = parsed.flags[in_aperture].astype(np.int64)
        fractions = {
            name: float(np.count_nonzero(flags_in & (1 << bit))) / aperture_pixels
            for name, bit in cfg.bad_flag_bits.items()
        }
    level = contamination_level(aperture_pixels, fractions, cfg.contamination_severe_fraction)

    omega, source = photometry.solid_angle(settings.photometry)
    phot = photometry.measure(cal.i_z, parsed.variance, cal.bad, omega, xn, yn, cfg, source)

    intensity, sigma = reproject_step.to_grid(
        cal.i_prime, cal.variance, parsed.wcs, grid, cfg.reprojection
    )
    good_fraction = float(np.count_nonzero(np.isfinite(intensity))) / (grid.height * grid.width)
    packed, saturated = binfmt.pack_item(intensity, sigma, cfg.float16_max)
    cx, cy, cerr = centroid.measure(
        intensity,
        sigma,
        target_x,
        target_y,
        frame_index_seed,
        radius=cfg.centroid_window_radius_px,
        n_samples=cfg.centroid_mc_samples,
        job_seed=job_seed,
    )

    frame = {
        "frame_key": exposure.frame_key,
        "obs_id": parsed.obs_id,
        "release": exposure.release,
        "processing_version": parsed.version,
        "detector": exposure.detector,
        "mjd": exposure.mjd,
        "obs_time_utc": mjd_to_iso_utc(exposure.mjd),
        "lambda_um": lam,
        "bandwidth_um": bandwidth,
        "lambda_min_um": lam_min,
        "lambda_max_um": lam_max,
        "channel": channels.nearest_channel(lam),
        "target_ra_deg": ra_t,
        "target_dec_deg": dec_t,
        "target_x": float(target_x),
        "target_y": float(target_y),
        "good_fraction": good_fraction,
        "aperture_pixels": aperture_pixels,
        "flag_fractions": fractions,
        "contamination_level": level,
        "saturated_pixels": saturated,
        "alignment_residual_px": None,
        "source_uri": exposure.source_uri,
    }
    return FrameResult(
        frame=frame,
        packed=packed,
        phot=phot,
        centroid=(cx, cy, cerr),
        intensity=intensity,
        sigma=sigma,
        good_fraction=good_fraction,
        wavelength_span_um=lam_max - lam_min,
    )
