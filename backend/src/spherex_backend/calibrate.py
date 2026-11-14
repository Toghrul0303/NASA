"""Calibration: ``I' = IMAGE - ZODI - B`` with the bad-pixel mask (section 6.4.4).

``BAD_MASK = 712439`` marks bad pixels; ``SOURCE`` (bit 21) is benign and is never part of it.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from astropy.stats import sigma_clipped_stats

from spherex_backend.config import ProcessingConfig

MIN_BACKGROUND_PIXELS = 10


@dataclass
class Calibrated:
    i_z: np.ndarray  # IMAGE - ZODI (not masked)
    bad: np.ndarray  # bool
    background: float  # B
    i_prime: np.ndarray  # I' with bad pixels set to NaN
    variance: np.ndarray  # VARIANCE with bad pixels set to NaN


def bad_pixels(
    flags: np.ndarray, image: np.ndarray, variance: np.ndarray, bad_mask: int
) -> np.ndarray:
    """``(flags & bad_mask) != 0`` or a non-finite image/variance or ``variance <= 0``."""
    flagged = (flags.astype(np.int64) & bad_mask) != 0
    with np.errstate(invalid="ignore"):
        return flagged | ~np.isfinite(image) | ~np.isfinite(variance) | (variance <= 0)


def estimate_background(
    i_z: np.ndarray,
    bad: np.ndarray,
    xn: float,
    yn: float,
    mask_radius_px: float,
    sigma: float,
    iters: int,
) -> float:
    """Sigma-clipped median of the good pixels outside ``mask_radius_px`` of the target."""
    ys, xs = np.indices(i_z.shape)
    outside = np.hypot(xs - xn, ys - yn) > mask_radius_px
    usable = ~bad & outside & np.isfinite(i_z)
    values = i_z[usable]
    if values.size < MIN_BACKGROUND_PIXELS:
        return 0.0
    _, median, _ = sigma_clipped_stats(values, sigma=sigma, maxiters=iters)
    return float(median)


def calibrate(
    image: np.ndarray,
    zodi: np.ndarray,
    variance: np.ndarray,
    flags: np.ndarray,
    xn: float,
    yn: float,
    cfg: ProcessingConfig,
) -> Calibrated:
    i_z = image - zodi
    bad = bad_pixels(flags, image, variance, cfg.bad_mask) | ~np.isfinite(i_z)
    background = estimate_background(
        i_z,
        bad,
        xn,
        yn,
        cfg.background_source_mask_radius_px,
        cfg.background_clip_sigma,
        cfg.background_clip_iters,
    )
    i_prime = i_z - background
    i_prime[bad] = np.nan
    masked_variance = variance.copy()
    masked_variance[bad] = np.nan
    return Calibrated(i_z, bad, background, i_prime, masked_variance)
