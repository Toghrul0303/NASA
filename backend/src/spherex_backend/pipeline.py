"""Pipeline entry point: discover, fetch_process, aggregate, gaia, export (section 6.1-6.2)."""

from __future__ import annotations

import base64
import logging
import threading
import time
import zlib
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Protocol

import numpy as np
from astropy.utils.data import conf as astropy_data_conf

from spherex_backend import channels, discovery, fetch, sampling
from spherex_backend.alignment import alignment_residuals
from spherex_backend.coadd import build_coadds, combine
from spherex_backend.config import LoadedSettings
from spherex_backend.contract_check import load_registry, validate_directory
from spherex_backend.export import ExportData, export_run
from spherex_backend.frames import FrameResult, process_frame
from spherex_backend import binfmt
from spherex_backend.gaia import (
    AstroqueryGaiaClient,
    GaiaClient,
    adopt_proper_motion,
    build_gaia_doc,
    query_gaia,
)
from spherex_backend.grid import Grid
from spherex_backend.group import assign_epochs
from spherex_backend.models import Exposure, PipelineError, Target
from spherex_backend.parse import InvalidCutout
from spherex_backend.pmfit import measure_pm
from spherex_backend.rgb import render_gray, render_rgb, rgb_presets

log = logging.getLogger("spherex.pipeline")
PROGRESS_MIN_INTERVAL_S = 0.25  # at most four progress events per second


class EventSink(Protocol):
    def emit(self, event: str, payload: dict[str, Any]) -> None: ...


@dataclass
class PipelineOutcome:
    slug: str
    result_status: Literal["complete", "partial"]
    data_version: str
    n_frames: int
    n_epochs: int
    n_failed_fetches: int
    files: dict[str, dict[str, Any]]
    elapsed_s: float
    n_skipped_breaker: int = 0
    n_skipped_budget: int = 0


@dataclass
class _Unit:
    index: int
    exposure: Exposure
    result: FrameResult | None = None
    status: str = "ok"  # fetch status: ok, failed, skipped_breaker, skipped_deadline
    attempts: int = 0
    group: str = ""
    retryable: bool = False  # a fetch failure the backfill pass may try again
    message: str = ""


def run_pipeline(
    target: Target,
    sink: EventSink,
    deadline: float | None = None,
    *,
    loaded: LoadedSettings,
    discovery_client: discovery.DiscoveryClient | None = None,
    gaia_client: GaiaClient | None = None,
    job_id: str | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> PipelineOutcome:
    """Run all five stages for ``target``; ``deadline`` is a ``time.monotonic()`` value.

    Tier 2 targets run with ``tier2_overrides`` applied (``loaded.effective("tier2")``).
    """
    loaded = loaded.effective(target.tier)
    try:
        return _run(target, sink, deadline, loaded, discovery_client, gaia_client, job_id, sleep)
    except PipelineError:
        raise
    except Exception as exc:
        log.exception("pipeline failed")
        raise PipelineError("internal_error", f"{type(exc).__name__}: {exc}", False) from exc


def _run(
    target: Target,
    sink: EventSink,
    deadline: float | None,
    loaded: LoadedSettings,
    discovery_client: discovery.DiscoveryClient | None,
    gaia_client: GaiaClient | None,
    job_id: str | None,
    sleep: Callable[[float], None],
) -> PipelineOutcome:
    settings, paths = loaded.settings, loaded.paths
    irsa, cfg = settings.irsa, settings.processing
    started = time.monotonic()
    emit_lock = threading.Lock()

    def emit(event: str, payload: dict[str, Any]) -> None:
        with emit_lock:
            sink.emit(event, payload)

    def elapsed() -> float:
        return round(time.monotonic() - started, 3)

    stage_marks: dict[str, float] = {}
    stage_seconds: dict[str, float] = {}

    def stage(name: str, state: str) -> None:
        now = elapsed()
        if state == "started":
            stage_marks[name] = now
        else:
            stage_seconds[name] = round(now - stage_marks.get(name, 0.0), 3)
        emit("stage", {"stage": name, "state": state, "elapsed_s": now})

    def check_deadline() -> None:
        if deadline is not None and time.monotonic() > deadline:
            raise PipelineError("timeout", "The job exceeded its time limit.", retryable=True)

    astropy_data_conf.remote_timeout = irsa.remote_timeout_s
    fetch.configure(irsa, fetch.breaker_path(loaded))
    fetch_deadline = started + settings.fetch_budget_s if settings.fetch_budget_s else None
    try:
        channels.load_channels(paths.channels_file)
    except (FileNotFoundError, ValueError) as exc:
        raise PipelineError("internal_error", str(exc), retryable=False) from exc
    registry = load_registry(paths.schemas_dir) if settings.export.validate else None
    job_seed = zlib.crc32(target.slug.encode("utf-8"))

    # ---- 1. discover ---------------------------------------------------------------------
    stage("discover", "started")
    dclient = discovery_client or discovery.PyvoDiscoveryClient(irsa, paths.cache_dir, sleep)
    gclient = gaia_client or AstroqueryGaiaClient(settings.gaia, paths.cache_dir)
    found = discovery.discover(dclient, target, irsa)
    gaia_query = query_gaia(gclient, target, settings.gaia, sleep)
    target, center = adopt_proper_motion(target, gaia_query, found.t_mid, settings.gaia.match_radius_arcsec)
    exposures = discovery.build_exposures(target, found.candidates, irsa)
    grid = Grid.build(target.size_deg, center[0], center[1])
    version = discovery.data_version(exposures)
    failed_uris: list[str] = discovery.invalid_uris(target, found.invalid, irsa)

    # Sampling runs after center, grid, URIs and data_version are final, so those (and the
    # meta.observations time range) still cover every de-duplicated exposure. Frames dropped
    # here are never attempted and are not failed fetches.
    scfg = settings.sampling
    found_exposures = len(exposures)
    exposures, sample_report = sampling.select_exposures(
        exposures,
        scfg.max_frames_per_target,
        scfg.min_per_stratum,
        scfg.prefer_cached,
        scfg.cache_only,
        cfg.epoch_gap_days,
        lambda e: fetch.cache_path(paths.cache_dir, e.source_uri).is_file(),
    )
    log.info(
        "sampling_summary",
        extra={"slug": target.slug, "job_id": job_id or "cli", "stage": "discover",
               "data": sample_report.as_dict()},
    )
    if not exposures:
        raise PipelineError(
            "upstream_unavailable",
            "No cached cutouts are available and sampling.cache_only is set.",
            True,
        )
    emit(
        "discovery",
        {
            "n_exposures_found": found.n_found,
            "n_exposures": len(exposures),
            "releases": {r: sum(1 for e in exposures if e.release == r) for r in ("dr1", "qr3")},
            "detectors": {str(d): sum(1 for e in exposures if e.detector == d) for d in range(1, 7)},
            "tap_elapsed_s": round(found.tap_elapsed_s, 3),
        },
    )
    stage("discover", "finished")

    # ---- 2. fetch_process ------------------------------------------------------------------
    stage("fetch_process", "started")
    total = len(exposures) + len(failed_uris)  # selected exposures plus invalid-mjd rows
    counters = {"done": 0, "failed": len(failed_uris), "seq": 0}
    seen = {"min_bandwidth": float("inf"), "warned": False, "last_progress": 0.0}
    results: dict[str, FrameResult] = {}

    def progress(force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - seen["last_progress"] < PROGRESS_MIN_INTERVAL_S:
            return
        seen["last_progress"] = now
        emit(
            "progress",
            {
                "stage": "fetch_process",
                "total": total,
                "done": counters["done"],
                "failed": counters["failed"],
                "elapsed_s": elapsed(),
            },
        )

    def run_unit(index: int, exposure: Exposure, force_probe: bool = False) -> _Unit:
        check_deadline()
        unit = _Unit(index, exposure)

        def on_retry(attempt: int) -> None:
            emit(
                "warning",
                {
                    "code": "fetch_retry",
                    "message": f"Retrying cutout download (attempt {attempt}).",
                    "context": {"source_uri": exposure.source_uri, "attempt": attempt},
                },
            )

        fetched = fetch.fetch_cutout(
            exposure,
            paths.cache_dir,
            on_retry,
            breaker=fetch.BREAKER,
            fetch_deadline=fetch_deadline,
            irsa=irsa,
            force_probe=force_probe,
            sleep=sleep,
        )
        unit.status, unit.attempts = fetched.status, fetched.attempts
        unit.group, unit.message = fetched.group, fetched.message
        if fetched.path is None:
            unit.retryable = fetched.retryable and fetched.status != "skipped_deadline"
            return unit
        path = fetched.path
        try:
            unit.result = process_frame(path, exposure, target, grid, settings, index, job_seed)
        except InvalidCutout as exc:
            unit.message = str(exc)
        except Exception as exc:  # a bad cutout must not abort the whole job
            log.exception("processing %s failed", exposure.frame_key)
            unit.message = f"{type(exc).__name__}: {exc}"
        return unit

    failures: dict[str, _Unit] = {}  # units currently counted as failed, by frame_key

    def absorb(unit: _Unit, recovered: bool = False) -> None:
        """Record one finished unit (main thread only).

        A dropped unit counts in ``failed`` at once; when the backfill pass recovers it
        (``recovered``) it moves from ``failed`` to ``done``.
        """
        result = unit.result
        if result is not None:
            results[unit.exposure.frame_key] = result
            counters["done"] += 1
            if recovered:
                counters["failed"] -= 1
                failures.pop(unit.exposure.frame_key, None)
            counters["seq"] += 1
            f = result.frame
            h, w = grid.height, grid.width
            emit(
                "frame",
                {
                    "seq_frame": counters["seq"],
                    "frame": dict(f),
                    "pixels": {
                        "encoding": "base64",
                        "dtype": "float16",
                        "byte_order": "little",
                        "axes": ["plane", "y", "x"],
                        "shape": [2, h, w],
                        "data": base64.b64encode(result.packed).decode("ascii"),
                    },
                },
            )
            seen["min_bandwidth"] = min(seen["min_bandwidth"], f["bandwidth_um"])
            span = f["lambda_max_um"] - f["lambda_min_um"]
            if span > f["bandwidth_um"] and not seen["warned"]:
                seen["warned"] = True
                emit(
                    "warning",
                    {
                        "code": "wavelength_gradient",
                        "message": "Wavelength varies across a cutout by more than its bandwidth.",
                        "context": {"max_span_um": span, "min_bandwidth_um": seen["min_bandwidth"]},
                    },
                )
        elif not recovered:  # first pass: the frame is dropped and counts as failed now
            counters["failed"] += 1
            failures[unit.exposure.frame_key] = unit
            if unit.status == "skipped_breaker":
                text = f"Skipped: IRSA unresponsive for {unit.group}"
            elif unit.status == "skipped_deadline":
                text = "Skipped: fetch budget exhausted"
            elif unit.status == "failed":
                text = f"Cutout dropped after retries: {unit.message}"
            else:
                text = f"Cutout failed: {unit.message}"
            log.warning("frame %s: %s", unit.exposure.frame_key, text)
            emit(
                "warning",
                {
                    "code": "fetch_failed",
                    "message": text,
                    "context": {"source_uri": unit.exposure.source_uri, "attempt": unit.attempts},
                },
            )
        progress()

    def run_batch(batch: list[_Unit], first_pass: bool, force_probe: bool = False) -> list[_Unit]:
        """Run ``batch`` on the pool; ``first_pass`` batches hold fresh units (index, exposure)."""
        finished: list[_Unit] = []
        executor = ThreadPoolExecutor(max_workers=irsa.max_concurrent_fetches)
        try:
            futures: list[Future[_Unit]] = [
                executor.submit(run_unit, u.index, u.exposure, force_probe) for u in batch
            ]
            for future in as_completed(futures):
                unit = future.result()
                absorb(unit, recovered=not first_pass)
                finished.append(unit)
        finally:
            executor.shutdown(wait=True, cancel_futures=True)
        return finished

    first = run_batch([_Unit(i, e) for i, e in enumerate(exposures)], first_pass=True)

    # Backfill: units dropped by a retryable fetch failure. A group whose breaker is open gets
    # ONE forced probe; only if it succeeds is the rest of that group retried. Nothing else
    # touches the network for a group that is still down, and nothing runs past the budget.
    by_group: dict[str, list[_Unit]] = {}
    for u in sorted(first, key=lambda u: u.index):
        if u.result is None and u.retryable:
            by_group.setdefault(u.group, []).append(u)
    for group_name, units in by_group.items():
        if fetch_deadline is not None and time.monotonic() >= fetch_deadline:
            break
        pending = list(units)
        if irsa.breaker.enabled and fetch.BREAKER.is_open(group_name):
            probe = run_batch([pending[0]], first_pass=False, force_probe=True)[0]
            if probe.result is None and probe.status != "ok":
                continue  # still down: leave the whole group failed, no further network calls
            pending = pending[1:]
        if pending:
            run_batch(pending, first_pass=False)
    final_failures = sorted(failures.values(), key=lambda u: u.index)
    failed_uris.extend(u.exposure.source_uri for u in final_failures)
    n_skipped_breaker = sum(1 for u in final_failures if u.status == "skipped_breaker")
    n_skipped_budget = sum(1 for u in final_failures if u.status == "skipped_deadline")
    progress(force=True)  # done + failed == total
    stage("fetch_process", "finished")
    if not results:
        raise PipelineError(
            "upstream_unavailable", "Every SPHEREx cutout failed to download or process.", True
        )

    # ---- 3. aggregate ----------------------------------------------------------------------
    stage("aggregate", "started")
    ordered = sorted(
        results.values(), key=lambda r: (r.frame["mjd"], r.frame["detector"], r.frame["frame_key"])
    )
    frames = [dict(r.frame) for r in ordered]
    for index, frame in enumerate(frames):
        frame["index"] = index
    epoch_ids, epochs = assign_epochs(frames, cfg.epoch_gap_days)
    for frame, epoch_id in zip(frames, epoch_ids, strict=True):
        frame["epoch_id"] = epoch_id
    intensities = [r.intensity for r in ordered]
    sigmas = [r.sigma for r in ordered]
    coadds = build_coadds(frames, intensities, sigmas, target, grid, cfg)
    presets = rgb_presets(coadds.meta)
    detector_images = {
        c["detector"]: i
        for c, i in zip(coadds.meta, coadds.intensity, strict=True)
        if c["scope"] == "detector"
    }
    residuals = alignment_residuals(frames, intensities, detector_images, cfg)
    for frame, residual in zip(frames, residuals, strict=True):
        frame["alignment_residual_px"] = residual
    frames_doc = {
        "schema_version": "1.0.0",
        "slug": target.slug,
        "data_version": version,
        "n_frames": len(frames),
        "epochs": epochs,
        "frames": frames,
    }
    solid_angle_source = ordered[0].phot.solid_angle_source
    if any(r.phot.solid_angle_source != "sapm" for r in ordered):
        solid_angle_source = "nominal_pixel"
    sed_doc = {
        "schema_version": "1.0.0",
        "slug": target.slug,
        "data_version": version,
        "flux_unit": "mJy",
        "wavelength_unit": "um",
        "aperture_radii_px": cfg.photometry_radii_px,
        "primary_aperture_index": 0,
        "annulus_px": cfg.annulus_px,
        "solid_angle_source": solid_angle_source,
        "nominal_pixel_sr": settings.photometry.nominal_pixel_sr,
        "n_points": len(frames),
        "points": [
            {
                "frame_index": f["index"],
                "epoch_id": f["epoch_id"],
                "detector": f["detector"],
                "channel": f["channel"],
                "mjd": f["mjd"],
                "obs_time_utc": f["obs_time_utc"],
                "lambda_um": f["lambda_um"],
                "bandwidth_um": f["bandwidth_um"],
                "flux_mjy": r.phot.flux_mjy,
                "flux_err_mjy": r.phot.flux_err_mjy,
                "flagged": f["contamination_level"] != 0,
                "centroid_x": r.centroid[0],
                "centroid_y": r.centroid[1],
                "centroid_err_px": r.centroid[2],
            }
            for f, r in zip(frames, ordered, strict=True)
        ],
    }
    coadds_doc = {
        "schema_version": "1.0.0",
        "slug": target.slug,
        "data_version": version,
        "n_coadds": len(coadds.meta),
        "coadds": coadds.meta,
        "rgb_presets": presets,
    }
    stage("aggregate", "finished")

    # ---- 4. gaia ---------------------------------------------------------------------------
    stage("gaia", "started")
    if gaia_query.status == "unavailable":
        emit("warning", {"code": "gaia_unavailable", "message": "Gaia DR3 query was unavailable.", "context": None})
    measured_pm = measure_pm(frames, [r.centroid for r in ordered], grid, cfg)
    gaia_doc = build_gaia_doc(
        slug=target.slug,
        data_version=version,
        query=gaia_query,
        cfg=settings.gaia,
        t_mid=found.t_mid,
        center=center,
        epochs=epochs,
        grid=grid,
        measured_pm=measured_pm,
    )
    stage("gaia", "finished")

    # ---- 5. export -------------------------------------------------------------------------
    stage("export", "started")
    thumb_usable = [r for r in ordered if r.good_fraction > 0]
    if thumb_usable:
        thumb_i, _ = combine([r.intensity for r in thumb_usable], [r.sigma for r in thumb_usable])
    else:
        thumb_i = np.full((grid.height, grid.width), np.nan, dtype=np.float32)
    pv = settings.previews
    thumb = render_gray(thumb_i, pv.lower_percentile, pv.upper_percentile, pv.asinh_a)

    def merged(select: Callable[[dict[str, Any]], bool]) -> np.ndarray:
        picked = [k for k, c in enumerate(coadds.meta) if select(c)]
        if not picked:
            return np.full((grid.height, grid.width), np.nan, dtype=np.float32)
        return combine([coadds.intensity[k] for k in picked], [coadds.sigma[k] for k in picked])[0]

    rgb_detector = None
    drgb = presets["detector_rgb"]
    if drgb is not None:
        planes = [
            merged(lambda c, g=drgb[name]: c["scope"] == "detector" and c["detector"] in g)
            for name in ("red", "green", "blue")
        ]
        rgb_detector = render_rgb(*planes, pv.lower_percentile, pv.upper_percentile, pv.asinh_a)
    eq = presets["equal_channel_rgb"]
    planes = [
        merged(lambda c, g=eq[name]: c["scope"] == "channel" and c["channel"] in g)
        for name in ("red_channels", "green_channels", "blue_channels")
    ]
    rgb_equal = render_rgb(*planes, pv.lower_percentile, pv.upper_percentile, pv.asinh_a)

    coadd_bytes = [
        binfmt.pack_item(i, s, cfg.float16_max)[0]
        for i, s in zip(coadds.intensity, coadds.sigma, strict=True)
    ]
    mjds = [c.mjd for c in found.candidates if c.mjd is not None]
    data = ExportData(
        target=target,
        data_version=version,
        grid=grid,
        center=center,
        t_mid_mjd=found.t_mid,
        frames_doc=frames_doc,
        frame_bytes=[r.packed for r in ordered],
        coadds_doc=coadds_doc,
        coadd_bytes=coadd_bytes,
        sed_doc=sed_doc,
        gaia_doc=gaia_doc,
        thumb=thumb,
        rgb_detector=rgb_detector,
        rgb_equal_channel=rgb_equal,
        releases=[c.release for c in found.candidates],
        mjd_min=min(mjds),
        mjd_max=max(mjds),
        n_failed_fetches=counters["failed"],
        failed_source_uris=failed_uris,
    )

    def validator(path: Path) -> list[Any]:
        assert registry is not None
        return validate_directory(path, registry)

    files = export_run(
        data,
        settings,
        paths.data_dir,
        validator if registry is not None else None,
        job_id=job_id,
        cache_dir=paths.cache_dir,
    )
    stage("export", "finished")
    log.info(
        "job_summary",
        extra={
            "slug": target.slug,
            "job_id": job_id or "cli",
            "data": {
                "stage_seconds": stage_seconds,
                "n_exposures_found": found_exposures,
                "n_exposures_selected": len(exposures),
                "n_frames": len(frames),
                "n_epochs": len(epochs),
                "n_failed_fetches": counters["failed"],
                "n_skipped_breaker": n_skipped_breaker,
                "n_skipped_budget": n_skipped_budget,
                "bytes_written": sum(int(f["bytes"]) for f in files.values()),
                "tap_elapsed_s": round(found.tap_elapsed_s, 3),
                "elapsed_s": elapsed(),
            },
        },
    )
    return PipelineOutcome(
        slug=target.slug,
        result_status="partial" if counters["failed"] > 0 else "complete",
        data_version=version,
        n_frames=len(frames),
        n_epochs=len(epochs),
        n_failed_fetches=counters["failed"],
        files=files,
        elapsed_s=elapsed(),
        n_skipped_breaker=n_skipped_breaker,
        n_skipped_budget=n_skipped_budget,
    )

