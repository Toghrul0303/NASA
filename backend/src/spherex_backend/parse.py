"""Level-2 cutout parsing (BACKEND_SPEC section 6.4.3)."""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from pathlib import Path

import astropy.units as u
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS


class InvalidCutout(Exception):
    """The cutout is unusable (``invalid cutout``); the frame is dropped."""


@dataclass
class ParsedCutout:
    image: np.ndarray
    variance: np.ndarray
    flags: np.ndarray  # int32
    zodi: np.ndarray
    wcs: WCS  # spatial WCS (SIP included)
    wcs_spec: WCS  # alternate spectral WCS, key "W", .sip = None
    detector: int
    obs_id: str
    version: str | None
    psf: np.ndarray | None


def _text(value: object) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def parse_cutout(path: Path) -> ParsedCutout:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # alternate-WCS FITSFixedWarning noise
        with fits.open(path, memmap=False) as hdul:
            for name in ("IMAGE", "FLAGS", "VARIANCE", "ZODI"):
                if name not in hdul:
                    raise InvalidCutout(f"invalid cutout: missing {name}")
            header = hdul["IMAGE"].header
            primary = hdul[0].header
            image = np.array(hdul["IMAGE"].data, dtype=np.float64)
            variance = np.array(hdul["VARIANCE"].data, dtype=np.float64)
            zodi = np.array(hdul["ZODI"].data, dtype=np.float64)
            flags = np.array(hdul["FLAGS"].data).astype(np.int32)
            psf = None
            for name in ("PSF", "EPSF"):
                if name in hdul and hdul[name].data is not None:
                    psf = np.array(hdul[name].data)
                    break
            if not (image.shape == variance.shape == zodi.shape == flags.shape) or image.ndim != 2:
                raise InvalidCutout("invalid cutout: extension shapes differ")
            wcs = WCS(header, fobj=hdul)
            wcs_spec = WCS(header, fobj=hdul, key="W")
            wcs_spec.sip = None
            detector_raw = header.get("DETECTOR", primary.get("DETECTOR"))
            try:
                detector = int(detector_raw)
            except (TypeError, ValueError):
                raise InvalidCutout("invalid cutout: no DETECTOR keyword") from None
            obs_id = _text(primary.get("OBSID")) or _text(header.get("OBSID"))
            version = _text(primary.get("VERSION"))
    if obs_id is None:
        raise InvalidCutout("invalid cutout: no OBSID keyword")
    return ParsedCutout(image, variance, flags, zodi, wcs, wcs_spec, detector, obs_id, version, psf)


def wavelength_at(
    parsed: ParsedCutout, x: np.ndarray | float, y: np.ndarray | float
) -> tuple[np.ndarray, np.ndarray]:
    """``(lambda_um, bandwidth_um)`` at native 0-based pixels via the spectral WCS."""
    wavelength, bandwidth = parsed.wcs_spec.pixel_to_world(x, y)
    return (
        np.asarray(wavelength.to(u.micrometer).value, dtype=np.float64),
        np.asarray(bandwidth.to(u.micrometer).value, dtype=np.float64),
    )
