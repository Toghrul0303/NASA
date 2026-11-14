"""Aperture photometry on native cutout pixels (BACKEND_SPEC section 6.4.5)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
from astropy.stats import sigma_clip

from spherex_backend.config import PhotometryConfig, ProcessingConfig

MJY_TO_MJY_FACTOR = 1e9  # 1 MJy = 1e9 mJy


@dataclass
class PhotResult:
    flux_mjy: list[float | None]
    flux_err_mjy: list[float | None]
    solid_angle_source: Literal["sapm", "nominal_pixel"]


def solid_angle(photometry: PhotometryConfig) -> tuple[float, Literal["sapm", "nominal_pixel"]]:
    """Nominal pixel solid angle; SAPM is disabled while ``sapm.uri_template`` is null."""
    return photometry.nominal_pixel_sr, "nominal_pixel"


def measure(
    i_z: np.ndarray,
    variance: np.ndarray,
    bad: np.ndarray,
    omega_sr: np.ndarray | float,
    xn: float,
    yn: float,
    cfg: ProcessingConfig,
    source: Literal["sapm", "nominal_pixel"] = "nominal_pixel",
) -> PhotResult:
    """Background-subtracted flux in mJy for each of ``cfg.photometry_radii_px``.

    Both outputs are ``None`` together when the aperture or the annulus has no valid pixel.
    """
    ys, xs = np.indices(i_z.shape)
    distance = np.hypot(xs - xn, ys - yn)
    omega = np.broadcast_to(np.asarray(omega_sr, dtype=np.float64), i_z.shape)
    valid = ~bad & np.isfinite(i_z) & np.isfinite(variance)

    inner, outer = cfg.annulus_px
    annulus = valid & (distance >= inner) & (distance <= outer)
    b_ann: float | None = None
    sigma_b = 0.0
    if annulus.any():
        clipped = sigma_clip(
            i_z[annulus], sigma=cfg.background_clip_sigma, maxiters=cfg.background_clip_iters
        ).compressed()
        if clipped.size:
            b_ann = float(np.mean(clipped))
            sigma_b = float(np.std(clipped) / np.sqrt(clipped.size))

    fluxes: list[float | None] = []
    errors: list[float | None] = []
    for radius in cfg.photometry_radii_px:
        aperture = valid & (distance <= radius)
        if b_ann is None or not aperture.any():
            fluxes.append(None)
            errors.append(None)
            continue
        omega_sum = float(omega[aperture].sum())
        flux = float(np.sum(i_z[aperture] * omega[aperture])) - b_ann * omega_sum
        var = float(np.sum(variance[aperture] * omega[aperture] ** 2)) + (sigma_b * omega_sum) ** 2
        fluxes.append(flux * MJY_TO_MJY_FACTOR)
        errors.append(float(np.sqrt(var)) * MJY_TO_MJY_FACTOR)
    return PhotResult(fluxes, errors, source)
