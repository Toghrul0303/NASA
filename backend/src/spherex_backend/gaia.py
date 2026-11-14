"""Gaia DR3 cone search via the ESA TAP service and the gaia.json model.

BACKEND_SPEC sections 6.3.3, 6.3.4 and 6.6; DATA_CONTRACT section 9.
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, Protocol

import numpy as np

from spherex_backend.config import GaiaConfig
from spherex_backend.discovery import separation_arcsec
from spherex_backend.grid import Grid
from spherex_backend.models import Target
from spherex_backend.timeutil import propagate

ADQL_TEMPLATE = (
    "SELECT source_id, ra, dec, ref_epoch, pmra, pmdec, parallax, parallax_error, phot_g_mean_mag "
    "FROM {table} "
    "WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra}, {dec}, {radius_deg}))"
)


@dataclass(frozen=True)
class GaiaRow:
    source_id: str  # never a number: up to 19 digits
    ra: float
    dec: float
    ref_epoch: float
    pmra: float | None
    pmdec: float | None
    parallax: float | None
    parallax_error: float | None
    phot_g_mean_mag: float | None


class GaiaClient(Protocol):
    def cone(self, ra_deg: float, dec_deg: float, radius_arcsec: float) -> list[GaiaRow]: ...


@dataclass
class GaiaQuery:
    status: Literal["ok", "unavailable"]
    center_ra_deg: float
    center_dec_deg: float
    radius_arcsec: float
    executed_utc: str
    adql: str
    rows: list[GaiaRow]
    elapsed_s: float = 0.0


@dataclass(frozen=True)
class _Motion:
    """A position with proper motion; satisfies ``timeutil.PMState``."""

    input_ra_deg: float
    input_dec_deg: float
    coord_epoch_year: float
    pmra_mas_yr: float | None
    pmdec_mas_yr: float | None


def make_adql(table: str, ra_deg: float, dec_deg: float, radius_arcsec: float) -> str:
    return ADQL_TEMPLATE.format(
        table=table, ra=f"{ra_deg:.9f}", dec=f"{dec_deg:.9f}", radius_deg=f"{radius_arcsec / 3600.0:.9f}"
    )


def _optional(value: Any) -> float | None:
    if value is None or np.ma.is_masked(value):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


class AstroqueryGaiaClient:
    """Anonymous synchronous ``astroquery.gaia`` queries with a disk cache."""

    def __init__(self, cfg: GaiaConfig, cache_dir: Path) -> None:
        self._cfg = cfg
        self._dir = cache_dir / "gaia"

    def cone(self, ra_deg: float, dec_deg: float, radius_arcsec: float) -> list[GaiaRow]:
        adql = make_adql(self._cfg.table, ra_deg, dec_deg, radius_arcsec)
        path = self._dir / f"{hashlib.sha256(adql.encode()).hexdigest()}.json"
        try:
            if time.time() - path.stat().st_mtime <= self._cfg.cache_ttl_days * 86400:
                return [GaiaRow(**r) for r in json.loads(path.read_text(encoding="utf-8"))]
        except (OSError, ValueError, TypeError):
            pass
        from astroquery.gaia import Gaia

        Gaia.MAIN_GAIA_TABLE = self._cfg.table
        Gaia.ROW_LIMIT = -1
        job = Gaia.launch_job(adql, dump_to_file=False)
        table = job.get_results()
        rows = [
            GaiaRow(
                source_id=str(int(rec["source_id"])),
                ra=float(rec["ra"]),
                dec=float(rec["dec"]),
                ref_epoch=float(rec["ref_epoch"]),
                pmra=_optional(rec["pmra"]),
                pmdec=_optional(rec["pmdec"]),
                parallax=_optional(rec["parallax"]),
                parallax_error=_optional(rec["parallax_error"]),
                phot_g_mean_mag=_optional(rec["phot_g_mean_mag"]),
            )
            for rec in table
        ]
        self._dir.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps([r.__dict__ for r in rows]), encoding="utf-8")
        tmp.replace(path)
        return rows


def _now_utc() -> str:
    moment = datetime.now(UTC)
    return f"{moment:%Y-%m-%dT%H:%M:%S}.{moment.microsecond // 1000:03d}Z"


def cone_radius_arcsec(target: Target, cfg: GaiaConfig) -> float:
    """DATA_CONTRACT section 9.2 item 1 (BACKEND_SPEC section 6.3.3)."""
    if target.pmra_mas_yr is None or target.pmdec_mas_yr is None:
        return cfg.static_radius_arcsec
    mu = math.hypot(target.pmra_mas_yr, target.pmdec_mas_yr) / 1000.0
    return mu * abs(cfg.reference_epoch_year - target.coord_epoch_year) + 10.0


def query_gaia(
    client: GaiaClient,
    target: Target,
    cfg: GaiaConfig,
    sleep: Callable[[float], None] = time.sleep,
) -> GaiaQuery:
    """Run the cone search; exhausted retries give ``status = "unavailable"``."""
    radius = cone_radius_arcsec(target, cfg)
    adql = make_adql(cfg.table, target.input_ra_deg, target.input_dec_deg, radius)
    started = time.monotonic()
    for attempt in range(1, cfg.retries + 1):
        try:
            rows = client.cone(target.input_ra_deg, target.input_dec_deg, radius)
        except Exception:  # astroquery / network errors vary widely
            if attempt < cfg.retries:
                sleep(2.0 * attempt)
            continue
        return GaiaQuery(
            "ok", target.input_ra_deg, target.input_dec_deg, radius, _now_utc(), adql, rows,
            time.monotonic() - started,
        )
    return GaiaQuery(
        "unavailable", target.input_ra_deg, target.input_dec_deg, radius, _now_utc(), adql, [],
        time.monotonic() - started,
    )


def _source_position(row: GaiaRow, mjd: float) -> tuple[float, float]:
    motion = _Motion(row.ra, row.dec, row.ref_epoch, row.pmra, row.pmdec)
    return propagate(motion, mjd)


def evaluate_sources(
    rows: list[GaiaRow], t_mid: float, center: tuple[float, float], match_radius: float
) -> tuple[list[dict[str, Any]], str | None]:
    """Sources with separations at ``t_mid`` sorted ascending, plus the primary id (9.2 items 2-3)."""
    sources: list[dict[str, Any]] = []
    for row in rows:
        sep = separation_arcsec(_source_position(row, t_mid), center)
        sources.append(
            {
                "source_id": row.source_id,
                "ra_deg": row.ra,
                "dec_deg": row.dec,
                "ref_epoch_year": row.ref_epoch,
                "pmra_mas_yr": row.pmra,
                "pmdec_mas_yr": row.pmdec,
                "parallax_mas": row.parallax,
                "parallax_error_mas": row.parallax_error,
                "phot_g_mean_mag": row.phot_g_mean_mag,
                "separation_arcsec": sep,
                "is_primary": False,
                "predicted_track": None,
            }
        )
    sources.sort(key=lambda s: (s["separation_arcsec"], s["source_id"]))
    primary = next((s for s in sources if s["separation_arcsec"] <= match_radius), None)
    if primary is not None:
        primary["is_primary"] = True
    return sources, (primary["source_id"] if primary else None)


def adopt_proper_motion(
    target: Target, query: GaiaQuery, t_mid: float, match_radius: float
) -> tuple[Target, tuple[float, float]]:
    """Section 6.3.4: adopt the primary's Gaia motion when the match survives it."""
    center = propagate(target, t_mid)
    if query.status != "ok" or target.pm_source != "none":
        return target, center
    sources, primary_id = evaluate_sources(query.rows, t_mid, center, match_radius)
    if primary_id is None:
        return target, center
    primary = next(r for r in query.rows if r.source_id == primary_id)
    if primary.pmra is None or primary.pmdec is None:
        return target, center
    adopted = replace(
        target,
        pmra_mas_yr=primary.pmra,
        pmdec_mas_yr=primary.pmdec,
        parallax_mas=primary.parallax,
        pm_source="gaia_dr3",
        pm_reference=f"gaiadr3.gaia_source:{primary.source_id}",
    )
    new_center = propagate(adopted, t_mid)
    _, new_primary = evaluate_sources(query.rows, t_mid, new_center, match_radius)
    if new_primary == primary_id:
        return adopted, new_center
    return target, center


def build_gaia_doc(
    *,
    slug: str,
    data_version: str,
    query: GaiaQuery,
    cfg: GaiaConfig,
    t_mid: float,
    center: tuple[float, float],
    epochs: list[dict[str, Any]],
    grid: Grid,
    measured_pm: dict[str, Any] | None,
) -> dict[str, Any]:
    """The gaia.json model (DATA_CONTRACT section 9)."""
    match_radius = cfg.match_radius_arcsec
    doc: dict[str, Any] = {
        "schema_version": "1.0.0",
        "slug": slug,
        "data_version": data_version,
        "query_status": query.status,
        "query": {
            "endpoint": cfg.endpoint,
            "table": cfg.table,
            "center_ra_deg": query.center_ra_deg,
            "center_dec_deg": query.center_dec_deg,
            "radius_arcsec": query.radius_arcsec,
            "executed_utc": query.executed_utc,
            "adql": query.adql,
        },
        "match_radius_arcsec": match_radius,
    }
    if query.status == "unavailable":
        doc.update(
            n_sources_in_cone=0,
            verdict="unavailable",
            verdict_detail="Gaia DR3 query was unavailable.",
            primary_source_id=None,
            measured_pm=None,
            consistency=None,
            sources=[],
        )
        return doc

    sources, primary_id = evaluate_sources(query.rows, t_mid, center, match_radius)
    primary_row = next((r for r in query.rows if r.source_id == primary_id), None)
    if primary_row is not None:
        track = []
        for epoch in epochs:
            ra, dec = _source_position(primary_row, epoch["mjd_mean"])
            x, y = grid.world_to_pixel(ra, dec)
            track.append(
                {"epoch_id": epoch["epoch_id"], "mjd": epoch["mjd_mean"], "ra_deg": ra,
                 "dec_deg": dec, "x": x, "y": y}
            )
        next(s for s in sources if s["is_primary"])["predicted_track"] = track

    consistency: dict[str, Any] | None = None
    if (
        measured_pm is not None
        and primary_row is not None
        and primary_row.pmra is not None
        and primary_row.pmdec is not None
    ):
        d_ra = measured_pm["pmra_mas_yr"] - primary_row.pmra
        d_dec = measured_pm["pmdec_mas_yr"] - primary_row.pmdec
        sigma = max(measured_pm["pmra_err_mas_yr"], measured_pm["pmdec_err_mas_yr"])
        consistency = {
            "delta_pmra_mas_yr": d_ra,
            "delta_pmdec_mas_yr": d_dec,
            "sigma_combined_mas_yr": sigma,
            "within_3_sigma": math.hypot(d_ra, d_dec) <= 3.0 * sigma,
        }

    if primary_id is None:
        verdict = "no_counterpart"
        detail = (
            f"No Gaia DR3 source within {match_radius:g} arcsec of the target position "
            "at the mid-observation epoch."
        )
    elif consistency is not None and not consistency["within_3_sigma"]:
        verdict = "match_inconsistent"
        delta = math.hypot(consistency["delta_pmra_mas_yr"], consistency["delta_pmdec_mas_yr"])
        detail = (
            f"Gaia source {primary_id} matches in position but the measured proper motion "
            f"differs by {delta:.0f} mas/yr (above 3 sigma)."
        )
    elif consistency is not None:
        verdict = "match_consistent"
        detail = f"Gaia source {primary_id} matches in position and proper motion (within 3 sigma)."
    else:
        verdict = "match_consistent"
        detail = (
            f"Gaia source {primary_id} matches in position; "
            "proper-motion consistency was not evaluated."
        )
    doc.update(
        n_sources_in_cone=len(sources),
        verdict=verdict,
        verdict_detail=detail,
        primary_source_id=primary_id,
        measured_pm=measured_pm,
        consistency=consistency,
        sources=sources,
    )
    return doc
