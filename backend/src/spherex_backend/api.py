"""HTTP API (section 8): ``/data`` file service, health, and (below) the jobs endpoints."""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from filelock import FileLock, Timeout
from starlette.exceptions import HTTPException as StarletteHTTPException

from spherex_backend import __version__
from spherex_backend.config import LoadedSettings

log = logging.getLogger("spherex_backend.api")

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")  # common.schema.json slug
CONTENT_TYPES = {".json": "application/json", ".bin": "application/octet-stream", ".png": "image/png"}
# Contract files only (DATA_CONTRACT section 5/13). Anything else, including any path that
# contains "..", is not a member of this set and therefore 404s.
DATA_FILES = frozenset(
    {
        "meta.json",
        "frames.json",
        "frames.bin",
        "coadds.json",
        "coadds.bin",
        "sed.json",
        "gaia.json",
        "previews/thumb.png",
        "previews/rgb_detector.png",
        "previews/rgb_equal_channel.png",
    }
)
IMMUTABLE = "public, max-age=31536000, immutable"
LOCK_TIMEOUT_S = 10.0


class ApiError(Exception):
    """An error rendered with the section 11.5 envelope."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: list[dict[str, str]] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details or []
        self.headers = headers or {}


def error_response(exc: ApiError) -> JSONResponse:
    body = {"error": {"code": exc.code, "message": exc.message, "details": exc.details}}
    return JSONResponse(body, status_code=exc.status, headers=exc.headers)


def not_found(message: str = "Not found.") -> ApiError:
    return ApiError(404, "not_found", message)


# ---------------------------------------------------------------------------------------------
# /data service (section 8.4)
# ---------------------------------------------------------------------------------------------


class DataService:
    """Reads contract files, memoizing ETags and gzip bodies by ``(path, mtime_ns)``."""

    def __init__(self, data_dir: Path) -> None:
        self._data_dir = data_dir
        self._etags: dict[tuple[str, int], str] = {}
        self._gzip: dict[tuple[str, int], bytes] = {}
        self._meta: dict[tuple[str, int], dict[str, Any]] = {}

    @staticmethod
    def _sha(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    def _load_meta(self, meta_path: Path) -> tuple[dict[str, Any], str, int]:
        mtime = meta_path.stat().st_mtime_ns
        key = (str(meta_path), mtime)
        raw: bytes | None = None
        if key not in self._etags:
            raw = meta_path.read_bytes()
            self._etags[key] = self._sha(raw)
        if key not in self._meta:
            raw = raw if raw is not None else meta_path.read_bytes()
            parsed = json.loads(raw)
            self._meta[key] = parsed if isinstance(parsed, dict) else {}
        return self._meta[key], self._etags[key], mtime

    def lookup(
        self, slug: str, path: str, want_body: bool
    ) -> tuple[dict[str, Any], str, bytes | None, int, int]:
        """``(meta, etag, body, mtime_ns, size)`` for a contract file, or raise ``not_found``."""
        if not SLUG_RE.fullmatch(slug) or path not in DATA_FILES:
            raise not_found()
        directory = self._data_dir / slug
        lock = FileLock(str(self._data_dir / ".locks" / f"{slug}.lock"))
        try:
            # Serialised with export publication (section 6.7 item 7): either the old or the
            # new directory is observed, never a mixture.
            lock.acquire(timeout=LOCK_TIMEOUT_S)
        except Timeout:
            log.warning("data lock timeout", extra={"slug": slug})
        try:
            meta_path = directory / "meta.json"
            if not meta_path.is_file():
                raise not_found()
            try:
                meta, meta_etag, meta_mtime = self._load_meta(meta_path)
                if path == "meta.json":
                    body = meta_path.read_bytes() if want_body else None
                    return meta, meta_etag, body, meta_mtime, meta_path.stat().st_size
                file_path = directory / path
                if not file_path.is_file():
                    raise not_found()
                mtime = file_path.stat().st_mtime_ns
                listed = meta.get("files", {}).get(path)
                etag = listed.get("sha256") if isinstance(listed, dict) else None
                body = None
                if etag is None:  # previews are not in meta.files: hash the bytes, memoized
                    key = (str(file_path), mtime)
                    body = file_path.read_bytes()
                    etag = self._etags.setdefault(key, self._sha(body))
                if want_body and body is None:
                    body = file_path.read_bytes()
                return meta, etag, body, mtime, file_path.stat().st_size
            except FileNotFoundError:
                raise not_found() from None
        finally:
            if lock.is_locked:
                lock.release()

    def gzipped(self, slug: str, path: str, mtime_ns: int, body: bytes) -> bytes:
        key = (f"{slug}/{path}", mtime_ns)
        cached = self._gzip.get(key)
        if cached is None:
            cached = gzip.compress(body, compresslevel=6, mtime=0)
            self._gzip[key] = cached
        return cached


def _etag_matches(header: str | None, etag: str) -> bool:
    if header is None:
        return False
    for candidate in header.split(","):
        candidate = candidate.strip()
        if candidate == "*":
            return True
        if candidate.startswith("W/"):
            candidate = candidate[2:]
        if candidate == f'"{etag}"':
            return True
    return False


def _accepts_gzip(header: str | None) -> bool:
    if not header:
        return False
    for part in header.split(","):
        coding, _, params = part.strip().partition(";")
        if coding.strip().lower() in ("gzip", "x-gzip"):
            q = re.search(r"q\s*=\s*([0-9.]+)", params)
            return q is None or float(q.group(1)) > 0
    return False


def serve_data(service: DataService, request: Request, slug: str, path: str) -> Response:
    head = request.method == "HEAD"
    suffix = Path(path).suffix
    gz = suffix == ".json" and _accepts_gzip(request.headers.get("accept-encoding"))
    # HEAD needs the bytes only to size a gzip body; otherwise the file size is enough.
    meta, etag, body, mtime_ns, size = service.lookup(slug, path, want_body=(not head) or gz)
    headers = {"ETag": f'"{etag}"'}
    version = request.query_params.get("v")
    headers["Cache-Control"] = IMMUTABLE if version and version == meta.get("data_version") else "no-cache"
    if suffix == ".json":
        headers["Vary"] = "Accept-Encoding"
    if _etag_matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)

    content = body if body is not None else b""
    if gz:
        assert body is not None
        content = service.gzipped(slug, path, mtime_ns, body)
        headers["Content-Encoding"] = "gzip"
        size = len(content)
    headers["Content-Length"] = str(size)
    if head:
        content = b""
    return Response(content=content, status_code=200, headers=headers, media_type=CONTENT_TYPES[suffix])


# ---------------------------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------------------------


def create_app(loaded: LoadedSettings) -> FastAPI:
    settings, paths = loaded.settings, loaded.paths

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        for directory in (paths.data_dir, paths.data_dir / ".locks", paths.cache_dir):
            directory.mkdir(parents=True, exist_ok=True)
        yield

    app = FastAPI(title="SPHEREx Sky Explorer", version=__version__, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.server.cors_allow_origins,
        allow_methods=["GET", "HEAD", "POST", "OPTIONS"],
        allow_headers=["Last-Event-ID", "Content-Type", "If-None-Match", "Accept"],
        expose_headers=["ETag"],
    )
    service = DataService(paths.data_dir)

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 404:
            return error_response(not_found())
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    # A sync route runs in the thread pool: file reads and the publish lock never block the loop.
    @app.api_route("/data/{slug}/{path:path}", methods=["GET", "HEAD"])
    def data_file(request: Request, slug: str, path: str) -> Response:
        return serve_data(service, request, slug, path)

    return app
