"""Spectral channel table (BACKEND_SPEC section 5.4, DATA_CONTRACT sections 3.3 and 5.1)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, TypedDict

import numpy as np

# SPHEREx DR1 all-sky cube tile; its SPECTRAL_CHANNELS extension lists the 102 channels
# (IRSA tutorial "Using SPHEREx HiPS All-Sky Mosaic Cubes").
DEFAULT_CHANNELS_SOURCE = (
    "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/hips5_cube/hips_20261026/"
    "Norder5/Dir0/Npix445_cube.fits"
)
N_CHANNELS = 102
DICHROIC_CHANNELS = (50, 51)

# DATA_CONTRACT section 5.2, in this order.
LINE_MARKERS: list[dict[str, Any]] = [
    {"name": "Pa-beta", "lambda_um": 1.282},
    {"name": "H-minus", "lambda_um": 1.60},
    {"name": "Pa-alpha", "lambda_um": 1.875},
    {"name": "Br-gamma", "lambda_um": 2.166},
    {"name": "Br-beta", "lambda_um": 2.626},
    {"name": "PAH-3.3", "lambda_um": 3.30},
    {"name": "Br-alpha", "lambda_um": 4.052},
    {"name": "CO", "lambda_um": 4.67},
]


class ChannelRow(TypedDict):
    channel: int
    band: int
    band_channel: int
    lambda_um: float
    bandwidth_um: float | None


class FeatureLine(TypedDict):
    name: str
    lambda_um: float
    on_channel: int
    continuum_channels: list[int]


_table: list[ChannelRow] | None = None


def _plain(value: Any) -> float:
    """Shortest round-trip float of a float32 table value (0.753, not 0.7530000209...)."""
    return float(str(np.float32(value)))


def rows_from_table(table: Any) -> list[ChannelRow]:
    """Convert the ``SPECTRAL_CHANNELS`` table into ``meta.channels`` rows."""
    names = set(table.colnames)
    needed = {"DETECTOR", "SUBCHAN", "WAVELENGTH"}
    if not needed <= names:
        raise ValueError(f"SPECTRAL_CHANNELS lacks columns {sorted(needed - names)}; has {sorted(names)}")
    rows: list[ChannelRow] = []
    for record in table:
        band = int(record["DETECTOR"])
        band_channel = int(record["SUBCHAN"])
        bandwidth: float | None = None
        if "BANDWIDTH" in names:
            raw = record["BANDWIDTH"]
            if not np.ma.is_masked(raw) and np.isfinite(float(raw)) and float(raw) > 0:
                bandwidth = _plain(raw)
        rows.append(
            {
                "channel": 17 * (band - 1) + (band_channel - 1),
                "band": band,
                "band_channel": band_channel,
                "lambda_um": _plain(record["WAVELENGTH"]),
                "bandwidth_um": bandwidth,
            }
        )
    rows.sort(key=lambda r: r["channel"])
    return rows


def read_source(source: str) -> list[ChannelRow]:
    """Read the table from a cube tile or table file (path or URL)."""
    from astropy.io import fits
    from astropy.table import Table

    is_url = source.startswith(("http://", "https://"))
    # Range requests: the tile is ~300 MB but the table is a few kB at its end.
    kwargs: dict[str, Any] = {"use_fsspec": True, "lazy_load_hdus": True} if is_url else {}
    with fits.open(source, cache=False, **kwargs) as hdul:
        if "SPECTRAL_CHANNELS" not in hdul:
            raise ValueError(f"{source} has no SPECTRAL_CHANNELS extension")
        return rows_from_table(Table.read(hdul["SPECTRAL_CHANNELS"]))


def check_rows(rows: list[ChannelRow]) -> None:
    if len(rows) != N_CHANNELS:
        raise ValueError(f"expected {N_CHANNELS} channels, found {len(rows)}")
    if [r["channel"] for r in rows] != list(range(N_CHANNELS)):
        raise ValueError("channels are not 0..101 in order")


def write_channels(rows: list[ChannelRow], path: Path) -> None:
    check_rows(rows)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8", newline="\n")


def load_channels(path: Path | None = None) -> list[ChannelRow]:
    """Load and cache ``channels.json``; refuse a missing or malformed file."""
    global _table
    if path is None and _table is not None:
        return _table
    target = path or Path(__file__).parent / "resources" / "channels.json"
    if not target.is_file():
        raise FileNotFoundError(f"{target} is missing; run `spherex channels build`")
    rows: list[ChannelRow] = json.loads(target.read_text(encoding="utf-8"))
    check_rows(rows)
    _table = rows
    return rows


def nearest_channel(lambda_um: float, rows: list[ChannelRow] | None = None) -> int:
    """Argmin ``|lambda_c - lambda|``; ties resolve to the lower index (section 3.3)."""
    table = rows if rows is not None else load_channels()
    return min(table, key=lambda r: (abs(r["lambda_um"] - lambda_um), r["channel"]))["channel"]


def valid_channels() -> list[int]:
    return [c for c in range(N_CHANNELS) if c not in DICHROIC_CHANNELS]


def feature_lines(rows: list[ChannelRow] | None = None) -> list[FeatureLine]:
    """DATA_CONTRACT section 7.3 item 8."""
    table = rows if rows is not None else load_channels()
    valid = valid_channels()
    lines: list[FeatureLine] = []
    for marker in LINE_MARKERS:
        on = min(
            (r for r in table if r["channel"] in valid),
            key=lambda r: (abs(r["lambda_um"] - marker["lambda_um"]), r["channel"]),
        )["channel"]
        at = valid.index(on)
        lines.append(
            {
                "name": marker["name"],
                "lambda_um": marker["lambda_um"],
                "on_channel": on,
                "continuum_channels": [*valid[max(0, at - 2) : at], *valid[at + 1 : at + 3]],
            }
        )
    return lines
