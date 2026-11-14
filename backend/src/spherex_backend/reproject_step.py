"""Reprojection onto the common grid (section 6.4.4)."""

from __future__ import annotations

import numpy as np
from astropy.wcs import WCS
from reproject import reproject_exact, reproject_interp

from spherex_backend.grid import Grid


def to_grid(
    i_prime: np.ndarray,
    variance: np.ndarray,
    wcs: WCS,
    grid: Grid,
    method: str = "interp",
) -> tuple[np.ndarray, np.ndarray]:
    """Return ``(intensity, sigma)`` float32 arrays of shape ``(H, W)`` on ``grid``.

    The same method is applied to intensity and variance, ``sigma = sqrt(V)``. A pixel is valid
    only when the footprint is positive, both values are finite and ``sigma > 0``; invalid pixels
    are NaN in both planes. Row 0 is the southern row.
    """
    reproject = reproject_exact if method == "exact" else reproject_interp
    target_wcs = grid.to_astropy_wcs()
    shape = (grid.height, grid.width)
    intensity, footprint = reproject((i_prime, wcs), target_wcs, shape_out=shape, return_footprint=True)
    resampled_var, var_footprint = reproject(
        (variance, wcs), target_wcs, shape_out=shape, return_footprint=True
    )
    with np.errstate(invalid="ignore"):
        sigma = np.sqrt(resampled_var)
        valid = (
            (footprint > 0)
            & (var_footprint > 0)
            & np.isfinite(intensity)
            & np.isfinite(sigma)
            & (sigma > 0)
        )
    intensity = np.where(valid, intensity, np.nan).astype(np.float32)
    sigma = np.where(valid, sigma, np.nan).astype(np.float32)
    return intensity, sigma
