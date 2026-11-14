"""Domain objects (BACKEND_SPEC section 5.1) and the pipeline error type."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


class PipelineError(Exception):
    """A pipeline failure that maps to a ``failed`` event (DATA_CONTRACT section 12.3)."""

    def __init__(
        self,
        code: Literal["no_coverage", "upstream_unavailable", "timeout", "internal_error"],
        message: str,
        retryable: bool,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


@dataclass(frozen=True)
class Target:
    slug: str
    tier: Literal["tier1", "tier1_5", "tier2"]
    title: str
    name: str | None
    input_ra_deg: float
    input_dec_deg: float
    coord_epoch_year: float
    coord_epoch_assumed: bool
    pmra_mas_yr: float | None
    pmdec_mas_yr: float | None
    parallax_mas: float | None
    pm_source: Literal["gaia_dr3", "literature", "user", "none"]
    pm_reference: str | None
    size_deg: float


@dataclass(frozen=True)
class Exposure:
    """One row of discovery output."""

    source_uri: str
    base_uri: str
    frame_key: str
    release: Literal["dr1", "qr3"]
    detector: int
    mjd: float
    cutout_ra_deg: float
    cutout_dec_deg: float
