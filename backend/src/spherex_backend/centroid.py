"""Centroids on the common grid (BACKEND_SPEC section 6.4.6)."""

from __future__ import annotations

import numpy as np
from photutils.centroids import centroid_com

MIN_WINDOW_PIXELS = 5


def window_centroid(
    values: np.ndarray, window: np.ndarray
) -> tuple[float, float] | None:
    """Centre of mass of ``values`` inside ``window`` after median subtraction.

    ``window`` selects finite pixels. The window median is subtracted and negatives are
    clipped to 0. Returns grid ``(x, y)`` or ``None`` when fewer than 5 pixels remain or the
    clipped flux sums to 0.
    """
    if int(window.sum()) < MIN_WINDOW_PIXELS:
        return None
    ys, xs = np.nonzero(window)
    y1, y2, x1, x2 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    sub_window = window[y1:y2, x1:x2]
    sub = values[y1:y2, x1:x2].astype(np.float64)
    median = float(np.median(sub[sub_window]))
    data = np.clip(sub - median, 0.0, None)
    data[~sub_window] = 0.0
    if not np.isfinite(data).all() or data.sum() <= 0.0:
        return None
    cx, cy = centroid_com(data, mask=~sub_window)
    if not (np.isfinite(cx) and np.isfinite(cy)):
        return None
    return float(cx + x1), float(cy + y1)


def circular_window(
    intensity: np.ndarray, x0: float, y0: float, radius: float
) -> np.ndarray:
    ys, xs = np.indices(intensity.shape)
    return (np.hypot(xs - x0, ys - y0) <= radius) & np.isfinite(intensity)


def measure(
    intensity: np.ndarray,
    sigma: np.ndarray,
    x0: float,
    y0: float,
    frame_index_seed: int,
    radius: float = 3.0,
    n_samples: int = 50,
    job_seed: int = 0,
) -> tuple[float | None, float | None, float | None]:
    """``(x, y, err_px)`` in grid pixels, or ``(None, None, None)``.

    ``err_px = hypot(sigma_x, sigma_y)`` of ``n_samples`` Monte-Carlo realizations that perturb
    every window pixel by Gaussian noise of its ``sigma``; the RNG seed is
    ``job_seed + frame_index_seed``.
    """
    window = circular_window(intensity, x0, y0, radius) & np.isfinite(sigma)
    centre = window_centroid(intensity, window)
    if centre is None:
        return None, None, None
    rng = np.random.default_rng(job_seed + frame_index_seed)
    xs: list[float] = []
    ys: list[float] = []
    for _ in range(n_samples):
        noisy = intensity + rng.normal(size=intensity.shape) * np.where(window, sigma, 0.0)
        sample = window_centroid(noisy, window)
        if sample is not None:
            xs.append(sample[0])
            ys.append(sample[1])
    if len(xs) < 2:
        return None, None, None
    err = float(np.hypot(np.std(xs, ddof=1), np.std(ys, ddof=1)))
    return centre[0], centre[1], err
