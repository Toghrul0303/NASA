"""Little-endian float16 ``[item, plane, y, x]`` binaries (DATA_CONTRACT section 10).

``y = 0`` is the southern row. No flip happens here; the browser flips once in
``toCanvasOrder``.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

F16_MAX = 65504.0
_BYTES_PER_ELEMENT = 2
_PLANES = 2


def item_nbytes(height: int, width: int) -> int:
    """Byte length of one packed item (both planes)."""
    return _PLANES * height * width * _BYTES_PER_ELEMENT


def expected_nbytes(n_items: int, height: int, width: int) -> int:
    """``n * 2 * H * W * 2`` (contract section 10.1)."""
    return n_items * item_nbytes(height, width)


def pack_item(
    intensity: NDArray[np.floating],
    sigma: NDArray[np.floating],
    f16_max: float = F16_MAX,
) -> tuple[bytes, int]:
    """Pack one ``(H, W)`` intensity and sigma pair.

    Returns ``(bytes, saturated)`` where ``saturated`` counts finite values clipped
    to ``+-f16_max`` over both planes. Plane 1 is NaN exactly where plane 0 is NaN.
    """
    a = np.array(intensity, dtype=np.float64, copy=True)
    b = np.array(sigma, dtype=np.float64, copy=True)
    if a.ndim != 2 or a.shape != b.shape:
        raise ValueError(f"planes must be 2-D and equal in shape, got {a.shape} and {b.shape}")

    # +-Inf becomes NaN, then NaN is made to coincide across both planes.
    a[np.isinf(a)] = np.nan
    b[np.isinf(b)] = np.nan
    invalid = np.isnan(a) | np.isnan(b)
    a[invalid] = np.nan
    b[invalid] = np.nan

    saturated = int(np.count_nonzero(np.abs(a[~invalid]) > f16_max)) + int(
        np.count_nonzero(np.abs(b[~invalid]) > f16_max)
    )
    np.clip(a, -f16_max, f16_max, out=a)  # NaN passes through clip unchanged
    np.clip(b, -f16_max, f16_max, out=b)

    packed = np.concatenate([a.astype("<f2").ravel(), b.astype("<f2").ravel()])
    return packed.tobytes(), saturated


def unpack_item(
    buf: bytes, height: int, width: int
) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
    """Inverse of :func:`pack_item`; returns ``(intensity, sigma)`` as float32."""
    if len(buf) != item_nbytes(height, width):
        raise ValueError(
            f"expected {item_nbytes(height, width)} bytes for {height}x{width}, got {len(buf)}"
        )
    half = np.frombuffer(buf, dtype="<f2").reshape(_PLANES, height, width)
    return half[0].astype(np.float32), half[1].astype(np.float32)


def decode_array(buf: bytes, n_items: int, height: int, width: int) -> NDArray[np.float16]:
    """View a whole ``frames.bin`` / ``coadds.bin`` as ``[item, plane, y, x]`` float16."""
    want = expected_nbytes(n_items, height, width)
    if len(buf) != want:
        raise ValueError(f"expected {want} bytes for {n_items}x2x{height}x{width}, got {len(buf)}")
    return np.frombuffer(buf, dtype="<f2").reshape(n_items, _PLANES, height, width)
