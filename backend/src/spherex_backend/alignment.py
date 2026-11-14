"""Frame alignment residuals (BACKEND_SPEC section 6.5 item 5)."""

from __future__ import annotations

from typing import Any

import numpy as np
from astropy.stats import mad_std
from photutils.detection import find_peaks

from spherex_backend.centroid import window_centroid
from spherex_backend.config import ProcessingConfig

EXCLUDE_RADIUS_PX = 5.0
PEAK_SIGMA = 5.0
BOX_HALF_WIDTH = 2  # 5 x 5 window


def select_sources(
    coadd: np.ndarray, target_positions: list[tuple[float, float]], max_sources: int
) -> list[tuple[float, float]]:
    """Brightest local maxima of a detector coadd, away from every frame's target position."""
    finite = np.isfinite(coadd)
    if finite.sum() < 25:
        return []
    values = coadd[finite]
    background = float(np.median(values))
    noise = float(mad_std(values))
    if noise <= 0:
        return []
    threshold = background + PEAK_SIGMA * noise
    filled = np.where(finite, coadd, background - 10 * noise)
    peaks = find_peaks(filled, threshold, box_size=5, mask=~finite)
    if peaks is None or len(peaks) == 0:
        return []
    order = np.argsort(-np.asarray(peaks["peak_value"]))
    chosen: list[tuple[float, float]] = []
    for i in order:
        x, y = float(peaks["x_peak"][i]), float(peaks["y_peak"][i])
        if any(np.hypot(x - tx, y - ty) <= EXCLUDE_RADIUS_PX for tx, ty in target_positions):
            continue
        chosen.append((x, y))
        if len(chosen) == max_sources:
            break
    return chosen


def _box_centroid(image: np.ndarray, x: float, y: float) -> tuple[float, float] | None:
    ys, xs = np.indices(image.shape)
    window = (
        (np.abs(xs - round(x)) <= BOX_HALF_WIDTH)
        & (np.abs(ys - round(y)) <= BOX_HALF_WIDTH)
        & np.isfinite(image)
    )
    return window_centroid(image, window)


def alignment_residuals(
    frames: list[dict[str, Any]],
    intensities: list[np.ndarray],
    detector_coadds: dict[int, np.ndarray],
    cfg: ProcessingConfig,
) -> list[float | None]:
    """Per-frame RMS offset from the cross-frame median source positions (same detector)."""
    residuals: list[float | None] = [None] * len(frames)
    targets = [(f["target_x"], f["target_y"]) for f in frames]
    for detector, coadd in detector_coadds.items():
        members = [i for i, f in enumerate(frames) if f["detector"] == detector]
        sources = select_sources(coadd, targets, cfg.alignment_max_sources)
        if len(sources) < cfg.alignment_min_sources or not members:
            continue
        positions = np.full((len(members), len(sources), 2), np.nan)
        for row, i in enumerate(members):
            for col, (x, y) in enumerate(sources):
                found = _box_centroid(intensities[i], x, y)
                if found is not None:
                    positions[row, col] = found
        with np.errstate(all="ignore"):
            reference = np.nanmedian(positions, axis=0)
        for row, i in enumerate(members):
            offsets = positions[row] - reference
            ok = np.isfinite(offsets).all(axis=1)
            if int(ok.sum()) >= cfg.alignment_min_sources:
                residuals[i] = float(np.sqrt(np.mean(np.sum(offsets[ok] ** 2, axis=1))))
    return residuals
