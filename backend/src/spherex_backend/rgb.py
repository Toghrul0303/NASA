"""RGB presets and PNG preview rendering (DATA_CONTRACT section 7.3, BACKEND_SPEC 6.5 and 6.7)."""

from __future__ import annotations

import itertools
import math
from typing import Any

import numpy as np
from PIL import Image

from spherex_backend import channels

DETECTORS = [1, 2, 3, 4, 5, 6]


def equal_channel_rgb() -> dict[str, list[int]]:
    """Section 7.3 item 7 (constant in v1)."""
    return {
        "blue_channels": list(range(0, 33)),
        "green_channels": [*range(33, 50), *range(52, 68)],
        "red_channels": list(range(68, 102)),
    }


def detector_rgb(coadds: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Best contiguous 3-way partition of detectors 1..6 by ``min_group_snr`` (item 6).

    ``None`` when fewer than three ``detector``-scope coadds exist. Ties resolve to the smaller
    blue group, then the smaller green group.
    """
    snr: dict[int, float] = {}
    for coadd in coadds:
        if coadd["scope"] == "detector":
            value = coadd["snr_target"]
            snr[coadd["detector"]] = max(float(value), 0.0) if value is not None else 0.0
    if len(snr) < 3:
        return None

    def group_snr(group: list[int]) -> float:
        return math.sqrt(sum(snr.get(d, 0.0) ** 2 for d in group))

    best: tuple[float, int, int, list[list[int]]] | None = None
    for cut1, cut2 in itertools.combinations(range(1, len(DETECTORS)), 2):
        groups = [DETECTORS[:cut1], DETECTORS[cut1:cut2], DETECTORS[cut2:]]
        score = min(group_snr(g) for g in groups)
        candidate = (score, -len(groups[0]), -len(groups[1]), groups)
        if best is None or candidate[:3] > best[:3]:
            best = candidate
    assert best is not None
    blue, green, red = best[3]
    return {
        "blue": blue,
        "green": green,
        "red": red,
        "group_snr": {"blue": group_snr(blue), "green": group_snr(green), "red": group_snr(red)},
        "min_group_snr": best[0],
    }


def rgb_presets(coadds: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "detector_rgb": detector_rgb(coadds),
        "equal_channel_rgb": equal_channel_rgb(),
        "feature_lines": channels.feature_lines(),
    }


def asinh_stretch(
    values: np.ndarray, lo: float, hi: float, a: float
) -> np.ndarray:
    """``x = clip((v - lo)/(hi - lo), 0, 1)``; ``y = arcsinh(a x)/arcsinh(a)``; NaN maps to 0."""
    span = hi - lo if hi > lo else 1.0
    x = np.clip((np.nan_to_num(values, nan=lo) - lo) / span, 0.0, 1.0)
    y = np.arcsinh(a * x) / np.arcsinh(a)
    y = np.where(np.isfinite(values), y, 0.0)
    return np.round(y * 255.0).astype(np.uint8)


def _limits(values: np.ndarray, lower: float, upper: float) -> tuple[float, float]:
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return 0.0, 1.0
    lo, hi = np.percentile(finite, [lower, upper])
    return float(lo), float(hi)


def render_gray(
    image: np.ndarray, lower: float, upper: float, a: float
) -> Image.Image:
    """Mode ``L`` PNG image; array row 0 is the southern row, so rows are flipped."""
    lo, hi = _limits(image, lower, upper)
    return Image.fromarray(np.flipud(asinh_stretch(image, lo, hi, a)), mode="L")


def render_rgb(
    red: np.ndarray, green: np.ndarray, blue: np.ndarray, lower: float, upper: float, a: float
) -> Image.Image:
    """Mode ``RGB``; the three channels are normalized with pooled percentiles."""
    pooled = np.concatenate([red.ravel(), green.ravel(), blue.ravel()])
    lo, hi = _limits(pooled, lower, upper)
    stack = np.dstack([asinh_stretch(c, lo, hi, a) for c in (red, green, blue)])
    return Image.fromarray(np.flipud(stack), mode="RGB")
