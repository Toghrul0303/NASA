"""ASGI entry for uvicorn.

Railway and the container run::

    uvicorn spherex_backend.asgi:app --host 0.0.0.0 --port $PORT --workers 1

``DATA_DIR``, ``CORS_ORIGINS``, ``CORS_ORIGIN_REGEX``, and ``ENABLE_LIVE_JOBS``
are read when this module is imported.
"""

from __future__ import annotations

import os
from pathlib import Path

from spherex_backend.api import create_app
from spherex_backend.config import load_settings


def config_path() -> Path:
    """``SPHEREX_CONFIG``, else ``backend/config.yaml`` next to this source tree."""
    raw = os.environ.get("SPHEREX_CONFIG")
    if raw:
        return Path(raw)
    # backend/src/spherex_backend/asgi.py -> backend/config.yaml
    candidate = Path(__file__).resolve().parents[2] / "config.yaml"
    if candidate.is_file():
        return candidate
    cwd = Path.cwd() / "backend" / "config.yaml"
    if cwd.is_file():
        return cwd
    return candidate


app = create_app(load_settings(config_path()))
