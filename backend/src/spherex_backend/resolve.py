"""Tier 1 position resolution: SIMBAD name -> Gaia DR3 cone -> nearest source (§6.3.2)."""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from astropy import units as u
from astropy.coordinates import SkyCoord

from spherex_backend.config import LoadedSettings, Tier1Target
from spherex_backend.gaia import AstroqueryGaiaClient, GaiaClient, GaiaRow, _Motion
from spherex_backend.targets import TargetError, load_resolved
from spherex_backend.timeutil import propagate

J2000_MJD = 51544.5


def _separation_arcsec(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    a = SkyCoord(ra1 * u.deg, dec1 * u.deg)
    b = SkyCoord(ra2 * u.deg, dec2 * u.deg)
    return float(a.separation(b).arcsec)


@dataclass(frozen=True)
class Resolution:
    slug: str
    record: dict[str, Any]
    separation_arcsec: float


def resolve_entry(
    entry: Tier1Target,
    client: GaiaClient,
    max_separation_arcsec: float,
) -> Resolution:
    assert entry.resolver_name is not None and entry.position.gaia_search_radius_arcsec is not None
    coord = SkyCoord.from_name(entry.resolver_name)
    ra0, dec0 = float(coord.icrs.ra.deg), float(coord.icrs.dec.deg)
    rows = client.cone(ra0, dec0, entry.position.gaia_search_radius_arcsec)
    best: tuple[float, GaiaRow] | None = None
    for row in rows:
        motion = _Motion(row.ra, row.dec, row.ref_epoch, row.pmra, row.pmdec)
        ra2000, dec2000 = propagate(motion, J2000_MJD)
        sep = _separation_arcsec(ra0, dec0, ra2000, dec2000)
        if best is None or sep < best[0]:
            best = (sep, row)
    if best is None or best[0] > max_separation_arcsec:
        found = "no Gaia source" if best is None else f"nearest source {best[0]:.1f} arcsec away"
        raise TargetError(
            f"{entry.slug}: {found} (limit {max_separation_arcsec} arcsec) around {entry.resolver_name!r}"
        )
    sep, row = best
    has_pm = row.pmra is not None and row.pmdec is not None
    record: dict[str, Any] = {
        "input_ra_deg": row.ra,
        "input_dec_deg": row.dec,
        "coord_epoch_year": row.ref_epoch,
        "pmra_mas_yr": row.pmra if has_pm else None,
        "pmdec_mas_yr": row.pmdec if has_pm else None,
        "parallax_mas": row.parallax,
        "pm_source": "gaia_dr3" if has_pm else "none",
        "pm_reference": "Gaia DR3" if has_pm else None,
        "gaia_source_id": row.source_id,
    }
    if not math.isfinite(sep):
        raise TargetError(f"{entry.slug}: non-finite separation")
    return Resolution(entry.slug, record, sep)


def resolve_targets(
    loaded: LoadedSettings,
    slugs: list[str] | None = None,
    client: GaiaClient | None = None,
) -> list[Resolution]:
    """Resolve the Gaia-positioned Tier 1 targets and merge them into the resolved file."""
    settings = loaded.settings
    entries = [e for e in settings.tier1_targets if e.position.resolve == "gaia"]
    if slugs:
        known = {e.slug for e in settings.tier1_targets}
        unknown = sorted(set(slugs) - known)
        if unknown:
            raise TargetError(f"unknown slug(s): {', '.join(unknown)}")
        entries = [e for e in entries if e.slug in slugs]
    gaia = client or AstroqueryGaiaClient(settings.gaia, loaded.paths.cache_dir)
    results = [resolve_entry(e, gaia, settings.resolve.max_separation_arcsec) for e in entries]
    path = loaded.paths.resolved_targets_file
    merged = load_resolved(path)
    for r in results:
        merged[r.slug] = r.record
    write_resolved(path, merged)
    return results


def write_resolved(path: Path, data: dict[str, dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)
