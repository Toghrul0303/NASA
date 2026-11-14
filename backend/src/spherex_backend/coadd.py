"""Inverse-variance coadds (DATA_CONTRACT section 7, BACKEND_SPEC section 6.5)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

from spherex_backend.config import ProcessingConfig
from spherex_backend.grid import Grid
from spherex_backend.models import Target
from spherex_backend.timeutil import propagate


@dataclass
class CoaddResult:
    meta: list[dict[str, Any]]  # coadds.json `coadds`
    intensity: list[np.ndarray]  # float32 (H, W), same order
    sigma: list[np.ndarray]


def combine(
    intensities: Sequence[np.ndarray], sigmas: Sequence[np.ndarray]
) -> tuple[np.ndarray, np.ndarray]:
    """``w = 1/sigma^2`` (0 where NaN); ``Ibar = sum(wI)/sum(w)``, ``sbar = 1/sqrt(sum(w))``.

    Computed in float64, returned as float32; NaN where ``sum(w) == 0``.
    """
    shape = intensities[0].shape
    weight_sum = np.zeros(shape, dtype=np.float64)
    weighted = np.zeros(shape, dtype=np.float64)
    for intensity, sigma in zip(intensities, sigmas, strict=True):
        i64 = intensity.astype(np.float64)
        s64 = sigma.astype(np.float64)
        with np.errstate(divide="ignore", invalid="ignore"):
            w = 1.0 / (s64 * s64)
        w = np.where(np.isfinite(w) & np.isfinite(i64), w, 0.0)
        weight_sum += w
        weighted += w * np.where(w > 0, i64, 0.0)
    with np.errstate(divide="ignore", invalid="ignore"):
        mean = np.where(weight_sum > 0, weighted / weight_sum, np.nan)
        sbar = np.where(weight_sum > 0, 1.0 / np.sqrt(weight_sum), np.nan)
    return mean.astype(np.float32), sbar.astype(np.float32)


def snr_target(
    intensity: np.ndarray,
    sigma: np.ndarray,
    x: float,
    y: float,
    aperture_px: float,
    annulus_px: Sequence[float],
) -> float | None:
    """DATA_CONTRACT section 7.3 item 5 on the coadd grid."""
    ys, xs = np.indices(intensity.shape)
    distance = np.hypot(xs - x, ys - y)
    finite = np.isfinite(intensity) & np.isfinite(sigma)
    aperture = finite & (distance <= aperture_px)
    annulus = np.isfinite(intensity) & (distance >= annulus_px[0]) & (distance <= annulus_px[1])
    n = int(aperture.sum())
    if n == 0 or not annulus.any():
        return None
    flux = float(intensity[aperture].sum()) - n * float(np.median(intensity[annulus]))
    noise = float(np.sqrt(np.sum(sigma[aperture].astype(np.float64) ** 2)))
    if noise <= 0:
        return None
    return flux / noise


def build_coadds(
    frames: list[dict[str, Any]],
    intensities: list[np.ndarray],
    sigmas: list[np.ndarray],
    target: Target,
    grid: Grid,
    cfg: ProcessingConfig,
) -> CoaddResult:
    """All coadds of the three scopes, ordered as in section 7.3 item 1.

    ``frames`` carry final ``index`` and ``epoch_id``; frames with ``good_fraction == 0`` are
    excluded. Scopes with no member frames are omitted.
    """
    usable = [i for i, f in enumerate(frames) if f["good_fraction"] > 0]
    groups: list[tuple[str, int | None, int | None, int | None, list[int]]] = []

    keys = sorted({(frames[i]["epoch_id"], frames[i]["detector"]) for i in usable})
    for epoch_id, detector in keys:
        members = [i for i in usable if frames[i]["epoch_id"] == epoch_id and frames[i]["detector"] == detector]
        groups.append(("epoch_detector", epoch_id, detector, None, members))
    for detector in sorted({frames[i]["detector"] for i in usable}):
        members = [i for i in usable if frames[i]["detector"] == detector]
        groups.append(("detector", None, detector, None, members))
    for channel in sorted({frames[i]["channel"] for i in usable}):
        members = [i for i in usable if frames[i]["channel"] == channel]
        groups.append(("channel", None, channel // 17 + 1, channel, members))

    result = CoaddResult([], [], [])
    for index, (scope, epoch_id, detector, channel, members) in enumerate(groups):
        member_frames = [frames[i] for i in members]
        i_bar, s_bar = combine([intensities[i] for i in members], [sigmas[i] for i in members])
        mjds = [f["mjd"] for f in member_frames]
        mjd_mean = sum(mjds) / len(mjds)
        ra, dec = propagate(target, mjd_mean)
        gx, gy = grid.world_to_pixel(ra, dec)
        result.meta.append(
            {
                "index": index,
                "scope": scope,
                "epoch_id": epoch_id,
                "detector": detector,
                "channel": channel,
                "n_frames": len(members),
                "frame_indices": sorted(frames[i]["index"] for i in members),
                "mjd_min": min(mjds),
                "mjd_max": max(mjds),
                "mjd_mean": mjd_mean,
                "lambda_mean_um": sum(f["lambda_um"] for f in member_frames) / len(member_frames),
                "lambda_min_um": min(f["lambda_min_um"] for f in member_frames),
                "lambda_max_um": max(f["lambda_max_um"] for f in member_frames),
                "snr_target": snr_target(
                    i_bar, s_bar, float(gx), float(gy), cfg.aperture_radius_px, cfg.annulus_px
                ),
            }
        )
        result.intensity.append(i_bar)
        result.sigma.append(s_bar)
    return result
