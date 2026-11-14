"""Measured proper motion from centroids (BACKEND_SPEC section 6.6 item 2)."""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from spherex_backend.config import ProcessingConfig
from spherex_backend.grid import PIXEL_SCALE_ARCSEC, Grid
from spherex_backend.timeutil import mjd_to_year


def _wls(t: np.ndarray, y: np.ndarray, sigma: np.ndarray) -> tuple[float, float]:
    """Weighted linear fit ``y = a + b t``; returns ``(b, sigma_b)``.

    ``sigma_b`` comes from the covariance of the fit scaled by ``max(1, chi2 / dof)`` with
    ``dof = n - 2``, so scatter larger than the per-frame sigmas widens the error (it never
    narrows it). With ``dof <= 0`` there is nothing to scale by.
    """
    w = 1.0 / sigma**2
    s, sx, sy = w.sum(), (w * t).sum(), (w * y).sum()
    sxx, sxy = (w * t * t).sum(), (w * t * y).sum()
    delta = s * sxx - sx * sx
    if delta <= 0:
        raise ValueError("degenerate time baseline")
    slope = (s * sxy - sx * sy) / delta
    intercept = (sy - slope * sx) / s
    dof = len(t) - 2
    scale = max(1.0, float((w * (y - intercept - slope * t) ** 2).sum()) / dof) if dof > 0 else 1.0
    return float(slope), float(math.sqrt(scale * s / delta))


def measure_pm(
    frames: list[dict[str, Any]],
    centroids: list[tuple[float | None, float | None, float | None]],
    grid: Grid,
    cfg: ProcessingConfig,
) -> dict[str, Any] | None:
    """Weighted linear fit of tangent-plane offsets versus time; ``None`` below the thresholds.

    Uses frames with a centroid and ``contamination_level != 2``. Offsets are in arcsec relative
    to the grid centre (``xi`` east-positive and already scaled by cos dec); slopes are returned
    in mas/yr.
    """
    used = [
        (f, c)
        for f, c in zip(frames, centroids, strict=True)
        if c[0] is not None and c[1] is not None and f["contamination_level"] != 2
    ]
    if not used:
        return None
    epochs = {f["epoch_id"] for f, _ in used}
    mjds = [f["mjd"] for f, _ in used]
    baseline = max(mjds) - min(mjds)
    if len(epochs) < cfg.pm_fit_min_epochs or baseline < cfg.pm_fit_min_baseline_days:
        return None

    t = np.array([mjd_to_year(m) for m in mjds])
    xi = np.array([(c[0] - (grid.crpix1 - 1.0)) * grid.cdelt1_deg * 3600.0 for _, c in used])
    eta = np.array([(c[1] - (grid.crpix2 - 1.0)) * grid.cdelt2_deg * 3600.0 for _, c in used])
    sigma = np.array(
        [max(c[2] or 0.0, cfg.pm_centroid_sigma_floor_px) * PIXEL_SCALE_ARCSEC for _, c in used]
    )
    try:
        pmra, pmra_err = _wls(t, xi, sigma)
        pmdec, pmdec_err = _wls(t, eta, sigma)
    except ValueError:
        return None
    return {
        "pmra_mas_yr": pmra * 1000.0,
        "pmdec_mas_yr": pmdec * 1000.0,
        "pmra_err_mas_yr": pmra_err * 1000.0,
        "pmdec_err_mas_yr": pmdec_err * 1000.0,
        "n_frames_used": len(used),
        "n_epochs_used": len(epochs),
        "baseline_days": baseline,
        "method": "weighted_linear_centroid",
    }
