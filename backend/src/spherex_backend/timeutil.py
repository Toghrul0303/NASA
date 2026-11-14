"""Time and position helpers (BACKEND_SPEC section 5.2, DATA_CONTRACT section 3.1)."""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta
from typing import Protocol

_MJD_J2000 = 51544.5
_MJD_UNIX_EPOCH = 40587.0
_MS_PER_DAY = 86_400_000.0
_MAS_PER_DEG = 3.6e6


class PMState(Protocol):
    """Anything that carries the position and proper motion of section 3.1.

    `Target` (models.py) satisfies this structurally.
    """

    input_ra_deg: float
    input_dec_deg: float
    coord_epoch_year: float
    pmra_mas_yr: float | None
    pmdec_mas_yr: float | None


def mjd_to_year(mjd: float) -> float:
    """Julian year of an MJD: ``2000.0 + (mjd - 51544.5) / 365.25``."""
    return 2000.0 + (mjd - _MJD_J2000) / 365.25


def _wrap_ra(ra_deg: float) -> float:
    wrapped = ra_deg % 360.0
    return 0.0 if wrapped >= 360.0 else wrapped


def propagate(t: PMState, mjd: float) -> tuple[float, float]:
    """Linear proper-motion propagation to ``mjd`` (contract section 3.1, no parallax).

    ``pmra_mas_yr`` is already multiplied by cos(dec). Returns ``(ra_deg, dec_deg)``
    with RA wrapped into ``[0, 360)``. Without proper motion the input position is
    returned unchanged.
    """
    ra0 = t.input_ra_deg
    dec0 = t.input_dec_deg
    if t.pmra_mas_yr is None or t.pmdec_mas_yr is None:
        return _wrap_ra(ra0), dec0
    dt = mjd_to_year(mjd) - t.coord_epoch_year
    ra = ra0 + (t.pmra_mas_yr / _MAS_PER_DEG) * dt / math.cos(math.radians(dec0))
    dec = dec0 + (t.pmdec_mas_yr / _MAS_PER_DEG) * dt
    return _wrap_ra(ra), dec


def mjd_to_iso_utc(mjd: float) -> str:
    """ISO 8601 UTC string with a ``Z`` suffix, rounded to the nearest millisecond."""
    total_ms = round((mjd - _MJD_UNIX_EPOCH) * _MS_PER_DAY)
    moment = datetime(1970, 1, 1, tzinfo=UTC) + timedelta(milliseconds=total_ms)
    return f"{moment:%Y-%m-%dT%H:%M:%S}.{moment.microsecond // 1000:03d}Z"
