"""Atomic export of one ``/data/{slug}/`` directory (BACKEND_SPEC section 6.7).

Files are staged in ``data/.tmp/{slug}-{uuid}/``, validated, and published with a rename.
``meta.json`` is always written last.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
from filelock import FileLock
from PIL import Image

from spherex_backend import __version__, channels
from spherex_backend.config import Settings
from spherex_backend.contract_check import Violation
from spherex_backend.grid import Grid
from spherex_backend.models import PipelineError, Target

SCHEMA_VERSION = "1.0.0"
BACKGROUND_MODEL = "zodi_subtracted_plus_local_sigma_clipped"
MAX_FAILED_URIS = 500


@dataclass
class ExportData:
    target: Target
    data_version: str
    grid: Grid
    center: tuple[float, float]
    t_mid_mjd: float
    frames_doc: dict[str, Any]
    frame_bytes: list[bytes]
    coadds_doc: dict[str, Any]
    coadd_bytes: list[bytes]
    sed_doc: dict[str, Any]
    gaia_doc: dict[str, Any]
    thumb: Image.Image
    rgb_detector: Image.Image | None
    rgb_equal_channel: Image.Image
    releases: list[str]
    mjd_min: float
    mjd_max: float
    n_failed_fetches: int
    failed_source_uris: list[str]


def _default(value: Any) -> Any:
    if isinstance(value, np.generic):
        return value.item()
    raise TypeError(f"{type(value).__name__} is not JSON serializable")


def dumps(obj: Any) -> bytes:
    """Contract writer: finite numbers only, UTF-8, LF, no BOM."""
    text = json.dumps(
        obj, allow_nan=False, ensure_ascii=False, separators=(",", ":"), default=_default
    )
    return text.encode("utf-8")


def _entry(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def _now_utc() -> str:
    moment = datetime.now(UTC)
    return f"{moment:%Y-%m-%dT%H:%M:%S}.{moment.microsecond // 1000:03d}Z"


def _descriptor(name: str, n_items: int, grid: Grid) -> dict[str, Any]:
    return {
        "file": name,
        "dtype": "float16",
        "byte_order": "little",
        "axes": ["item", "plane", "y", "x"],
        "planes": ["intensity", "sigma"],
        "unit": "MJy/sr",
        "n_items": n_items,
        "height": grid.height,
        "width": grid.width,
        "bytes": n_items * 2 * grid.height * grid.width * 2,
    }


def build_meta(
    data: ExportData, settings: Settings, files: dict[str, dict[str, Any]], rgb_detector_path: str | None
) -> dict[str, Any]:
    t, g, p = data.target, data.grid, settings.processing
    n_frames = len(data.frame_bytes)
    return {
        "schema_version": SCHEMA_VERSION,
        "slug": t.slug,
        "tier": t.tier,
        "title": t.title,
        "status": "partial" if data.n_failed_fetches > 0 else "complete",
        "created_utc": _now_utc(),
        "data_version": data.data_version,
        "pipeline_version": __version__,
        "target": {
            "name": t.name,
            "input_ra_deg": t.input_ra_deg,
            "input_dec_deg": t.input_dec_deg,
            "coord_epoch_year": t.coord_epoch_year,
            "coord_epoch_assumed": t.coord_epoch_assumed,
            "pmra_mas_yr": t.pmra_mas_yr,
            "pmdec_mas_yr": t.pmdec_mas_yr,
            "parallax_mas": t.parallax_mas,
            "pm_source": t.pm_source,
            "pm_reference": t.pm_reference,
        },
        "center": {"ra_deg": data.center[0], "dec_deg": data.center[1], "t_mid_mjd": data.t_mid_mjd},
        "observations": {
            "n_frames": n_frames,
            "n_epochs": len(data.frames_doc["epochs"]),
            "mjd_min": data.mjd_min,
            "mjd_max": data.mjd_max,
            "releases": sorted(set(data.releases)),
            "n_failed_fetches": data.n_failed_fetches,
            "failed_source_uris": data.failed_source_uris[:MAX_FAILED_URIS],
        },
        "grid": {
            "size_deg": g.size_deg,
            "width": g.width,
            "height": g.height,
            "projection": "TAN",
            "pixel_scale_arcsec": settings.grid.pixel_scale_arcsec,
            "crval1_deg": g.crval1_deg,
            "crval2_deg": g.crval2_deg,
            "crpix1": g.crpix1,
            "crpix2": g.crpix2,
            "cdelt1_deg": g.cdelt1_deg,
            "cdelt2_deg": g.cdelt2_deg,
        },
        "binaries": {
            "frames": _descriptor("frames.bin", n_frames, g),
            "coadds": _descriptor("coadds.bin", len(data.coadd_bytes), g),
        },
        "processing": {
            "bad_mask": p.bad_mask,
            "bad_flag_bits": p.bad_flag_bits,
            "benign_flag_bits": p.benign_flag_bits,
            "photometry_radii_px": p.photometry_radii_px,
            "annulus_px": p.annulus_px,
            "background_model": BACKGROUND_MODEL,
            "reprojection": p.reprojection,
            "epoch_gap_days": p.epoch_gap_days,
            "contamination_severe_fraction": p.contamination_severe_fraction,
            "pm_fit_min_epochs": p.pm_fit_min_epochs,
            "pm_fit_min_baseline_days": p.pm_fit_min_baseline_days,
            "line_markers": channels.LINE_MARKERS,
        },
        "channels": channels.load_channels(),
        "previews": {
            "thumb": "previews/thumb.png",
            "rgb_detector": rgb_detector_path,
            "rgb_equal_channel": "previews/rgb_equal_channel.png",
            "stretch": {
                "type": "asinh",
                "lower_percentile": settings.previews.lower_percentile,
                "upper_percentile": settings.previews.upper_percentile,
            },
        },
        "files": files,
    }


def export_run(
    data: ExportData,
    settings: Settings,
    data_dir: Path,
    validate: Callable[[Path], list[Violation]] | None,
    job_id: str | None = None,
    cache_dir: Path | None = None,
) -> dict[str, dict[str, Any]]:
    """Stage, validate and publish; returns ``meta.files`` plus the ``meta.json`` entry."""
    slug = data.target.slug
    staging = data_dir / ".tmp" / f"{slug}-{uuid.uuid4().hex}"
    (staging / "previews").mkdir(parents=True)
    try:
        (staging / "frames.bin").write_bytes(b"".join(data.frame_bytes))
        (staging / "coadds.bin").write_bytes(b"".join(data.coadd_bytes))

        data.thumb.save(staging / "previews" / "thumb.png", format="PNG")
        data.rgb_equal_channel.save(staging / "previews" / "rgb_equal_channel.png", format="PNG")
        rgb_path: str | None = None
        if data.rgb_detector is not None:
            data.rgb_detector.save(staging / "previews" / "rgb_detector.png", format="PNG")
            rgb_path = "previews/rgb_detector.png"

        for name, doc in (
            ("frames.json", data.frames_doc),
            ("coadds.json", data.coadds_doc),
            ("sed.json", data.sed_doc),
            ("gaia.json", data.gaia_doc),
        ):
            (staging / name).write_bytes(dumps(doc))

        files = {
            name: _entry(staging / name)
            for name in ("frames.json", "frames.bin", "coadds.json", "coadds.bin", "sed.json", "gaia.json")
        }
        meta = build_meta(data, settings, files, rgb_path)
        (staging / "meta.json").write_bytes(dumps(meta))  # written last

        if validate is not None:
            violations = validate(staging)
            if violations:
                shown = "; ".join(str(v) for v in violations[:8])
                raise PipelineError(
                    "internal_error",
                    f"export validation failed ({len(violations)} violations): {shown}",
                    retryable=False,
                )
        _publish(staging, data_dir, slug)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise

    if data.target.tier == "tier2" and job_id is not None and cache_dir is not None:
        by_slug = cache_dir / "jobs" / "by_slug"
        by_slug.mkdir(parents=True, exist_ok=True)
        (by_slug / f"{slug}.json").write_text(json.dumps({"job_id": job_id}), encoding="utf-8")

    return {**files, "meta.json": _entry(data_dir / slug / "meta.json")}


def _publish(staging: Path, data_dir: Path, slug: str) -> None:
    locks = data_dir / ".locks"
    trash_root = data_dir / ".trash"
    locks.mkdir(parents=True, exist_ok=True)
    trash_root.mkdir(parents=True, exist_ok=True)
    final = data_dir / slug
    with FileLock(str(locks / f"{slug}.lock")):
        trash: Path | None = None
        if final.exists():
            trash = trash_root / f"{slug}-{uuid.uuid4().hex}"
            os.replace(final, trash)
        os.replace(staging, final)
        if trash is not None:
            shutil.rmtree(trash, ignore_errors=True)
