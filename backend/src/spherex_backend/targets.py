"""Target construction (BACKEND_SPEC section 6.3.1)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from spherex_backend.config import LoadedSettings, Tier1Target, Tier15Target
from spherex_backend.models import Target

TierName = Literal["tier1", "tier1_5", "all"]


class TargetError(Exception):
    """A configured target cannot be built (for example an unresolved Gaia position)."""


def load_resolved(path: Path) -> dict[str, dict[str, Any]]:
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def tier1_target(entry: Tier1Target, resolved: dict[str, dict[str, Any]]) -> Target:
    if entry.position.resolve == "gaia":
        record = resolved.get(entry.slug)
        if record is None:
            raise TargetError(
                f"{entry.slug}: no resolved position; run `spherex targets resolve --slug {entry.slug}`"
            )
        return Target(
            slug=entry.slug,
            tier="tier1",
            title=entry.title,
            name=entry.name,
            input_ra_deg=float(record["input_ra_deg"]),
            input_dec_deg=float(record["input_dec_deg"]),
            coord_epoch_year=float(record["coord_epoch_year"]),
            coord_epoch_assumed=False,
            pmra_mas_yr=record["pmra_mas_yr"],
            pmdec_mas_yr=record["pmdec_mas_yr"],
            parallax_mas=record["parallax_mas"],
            pm_source=record["pm_source"],
            pm_reference=record["pm_reference"],
            size_deg=entry.size_deg,
        )
    position = entry.position
    assert position.ra_deg is not None and position.dec_deg is not None
    assumed = position.coord_epoch_year is None
    pm = entry.pm
    return Target(
        slug=entry.slug,
        tier="tier1",
        title=entry.title,
        name=entry.name,
        input_ra_deg=position.ra_deg,
        input_dec_deg=position.dec_deg,
        coord_epoch_year=2000.0 if position.coord_epoch_year is None else position.coord_epoch_year,
        coord_epoch_assumed=assumed,
        pmra_mas_yr=pm.pmra_mas_yr if pm else None,
        pmdec_mas_yr=pm.pmdec_mas_yr if pm else None,
        parallax_mas=pm.parallax_mas if pm else None,
        pm_source="literature" if pm else "none",
        pm_reference=pm.reference if pm else None,
        size_deg=entry.size_deg,
    )


def tier15_target(entry: Tier15Target) -> Target:
    return Target(
        slug=entry.slug,
        tier="tier1_5",
        title=entry.title,
        name=None,
        input_ra_deg=entry.ra_deg,
        input_dec_deg=entry.dec_deg,
        coord_epoch_year=2000.0,
        coord_epoch_assumed=True,
        pmra_mas_yr=None,
        pmdec_mas_yr=None,
        parallax_mas=None,
        pm_source="none",
        pm_reference=None,
        size_deg=entry.size_deg,
    )


def tier2_target(
    slug: str,
    ra_deg: float,
    dec_deg: float,
    size_deg: float,
    name: str | None = None,
    pmra_mas_yr: float | None = None,
    pmdec_mas_yr: float | None = None,
    coord_epoch_year: float | None = None,
) -> Target:
    """Target from a normalized request (DATA_CONTRACT section 11.2)."""
    has_pm = pmra_mas_yr is not None and pmdec_mas_yr is not None
    return Target(
        slug=slug,
        tier="tier2",
        title=name or f"RA {ra_deg:.4f}, Dec {dec_deg:+.4f}",
        name=name,
        input_ra_deg=ra_deg,
        input_dec_deg=dec_deg,
        coord_epoch_year=2000.0 if coord_epoch_year is None else coord_epoch_year,
        coord_epoch_assumed=coord_epoch_year is None,
        pmra_mas_yr=pmra_mas_yr if has_pm else None,
        pmdec_mas_yr=pmdec_mas_yr if has_pm else None,
        parallax_mas=None,
        pm_source="user" if has_pm else "none",
        pm_reference=None,
        size_deg=size_deg,
    )


def configured_targets(
    loaded: LoadedSettings,
    tier: TierName = "all",
    slugs: list[str] | None = None,
) -> list[Target]:
    """Build the configured targets of ``tier`` (optionally limited to ``slugs``)."""
    settings = loaded.settings
    resolved = load_resolved(loaded.paths.resolved_targets_file)
    known = {e.slug for e in settings.tier1_targets} | {e.slug for e in settings.tier1_5_targets}
    unknown = sorted(set(slugs or []) - known)
    if unknown:
        raise TargetError(f"unknown slug(s): {', '.join(unknown)}")
    targets: list[Target] = []
    if tier in ("tier1", "all"):
        for entry in settings.tier1_targets:
            if not slugs or entry.slug in slugs:
                targets.append(tier1_target(entry, resolved))
    if tier in ("tier1_5", "all"):
        for entry15 in settings.tier1_5_targets:
            if not slugs or entry15.slug in slugs:
                targets.append(tier15_target(entry15))
    return targets
