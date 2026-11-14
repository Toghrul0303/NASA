"""Common grid: north-up gnomonic (TAN) at 6.15 arcsec/pixel (DATA_CONTRACT section 3.2)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import numpy as np

if TYPE_CHECKING:
    from astropy.wcs import WCS

PIXEL_SCALE_ARCSEC = 6.15
_SCALE_DEG = PIXEL_SCALE_ARCSEC / 3600.0
_SIZE_CHOICES_DEG = (0.05, 0.1, 0.2)


def _out(values: Any, like: Any) -> Any:
    """Return a Python float for scalar input, an ndarray otherwise."""
    if np.ndim(like) == 0:
        return float(values)
    return values


@dataclass(frozen=True)
class Grid:
    size_deg: float
    width: int
    height: int
    crval1_deg: float
    crval2_deg: float
    crpix1: float
    crpix2: float
    cdelt1_deg: float
    cdelt2_deg: float

    @staticmethod
    def build(size_deg: float, center_ra: float, center_dec: float) -> Grid:
        """Build the grid of section 3.2 centred on ``(center_ra, center_dec)``."""
        allowed = any(
            math.isclose(size_deg, c, rel_tol=0.0, abs_tol=1e-12) for c in _SIZE_CHOICES_DEG
        )
        if not allowed:
            raise ValueError(f"size_deg must be one of {_SIZE_CHOICES_DEG}, got {size_deg}")
        side = 2 * math.ceil(size_deg * 3600.0 / (2.0 * PIXEL_SCALE_ARCSEC))
        return Grid(
            size_deg=size_deg,
            width=side,
            height=side,
            crval1_deg=center_ra,
            crval2_deg=center_dec,
            crpix1=side / 2 + 0.5,
            crpix2=side / 2 + 0.5,
            cdelt1_deg=-_SCALE_DEG,
            cdelt2_deg=_SCALE_DEG,
        )

    def world_to_pixel(self, ra: Any, dec: Any) -> tuple[Any, Any]:
        """Gnomonic world to 0-based pixel (x east-to-west, y south-to-north).

        Implements the section 3.2 equations. Accepts floats or arrays (degrees).
        """
        ra_r = np.radians(np.asarray(ra, dtype=np.float64))
        dec_r = np.radians(np.asarray(dec, dtype=np.float64))
        ra_c = math.radians(self.crval1_deg)
        dec_c = math.radians(self.crval2_deg)
        d_ra = ra_r - ra_c
        denom = math.sin(dec_c) * np.sin(dec_r) + math.cos(dec_c) * np.cos(dec_r) * np.cos(d_ra)
        xi = np.degrees(np.cos(dec_r) * np.sin(d_ra) / denom)
        eta = np.degrees(
            (math.cos(dec_c) * np.sin(dec_r) - math.sin(dec_c) * np.cos(dec_r) * np.cos(d_ra))
            / denom
        )
        x = (self.crpix1 - 1.0) + xi / self.cdelt1_deg
        y = (self.crpix2 - 1.0) + eta / self.cdelt2_deg
        return _out(x, ra), _out(y, ra)

    def pixel_to_world(self, x: Any, y: Any) -> tuple[Any, Any]:
        """Inverse gnomonic projection: 0-based pixel to ``(ra_deg, dec_deg)``."""
        xi = np.radians((np.asarray(x, dtype=np.float64) - (self.crpix1 - 1.0)) * self.cdelt1_deg)
        eta = np.radians((np.asarray(y, dtype=np.float64) - (self.crpix2 - 1.0)) * self.cdelt2_deg)
        rho = np.hypot(xi, eta)
        c = np.arctan(rho)
        safe_rho = np.where(rho == 0.0, 1.0, rho)
        s = np.where(rho == 0.0, 1.0, np.sin(c) / safe_rho)  # sin(c) / rho
        dec_c = math.radians(self.crval2_deg)
        ra_c = math.radians(self.crval1_deg)
        dec = np.arcsin(np.cos(c) * math.sin(dec_c) + eta * s * math.cos(dec_c))
        ra = ra_c + np.arctan2(xi * s, math.cos(dec_c) * np.cos(c) - eta * s * math.sin(dec_c))
        ra_deg = np.degrees(ra) % 360.0
        ra_deg = np.where(ra_deg >= 360.0, 0.0, ra_deg)
        return _out(ra_deg, x), _out(np.degrees(dec), x)

    def to_astropy_wcs(self) -> WCS:
        """TAN WCS (``RA---TAN`` / ``DEC--TAN``) with 1-based ``crpix``, for reproject."""
        from astropy.wcs import WCS

        wcs = WCS(naxis=2)
        wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
        wcs.wcs.crval = [self.crval1_deg, self.crval2_deg]
        wcs.wcs.crpix = [self.crpix1, self.crpix2]
        wcs.wcs.cdelt = [self.cdelt1_deg, self.cdelt2_deg]
        wcs.wcs.cunit = ["deg", "deg"]
        return wcs
