"""HTTP API (section 8): ``/data`` file service, health, and (below) the jobs endpoints."""

from __future__ import annotations

import asyncio
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
from fastapi.responses import JSONResponse, Response, StreamingResponse
from filelock import FileLock, Timeout
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from starlette.exceptions import HTTPException as StarletteHTTPException

from spherex_backend import __version__
from spherex_backend.config import LoadedSettings
from spherex_backend.jobs import Job, JobManager, NormalizedRequest, QueueFull, SubmitResult

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
# POST /api/jobs (section 8.2)
# ---------------------------------------------------------------------------------------------

SIZE_CHOICES = (0.05, 0.1, 0.2)


class JobRequest(BaseModel):
    """Strict request model: no extra fields, no string-to-number or string-to-bool coercion."""

    model_config = ConfigDict(extra="forbid", strict=True)

    ra_deg: float = Field(ge=0.0, lt=360.0, allow_inf_nan=False)
    dec_deg: float = Field(ge=-90.0, le=90.0, allow_inf_nan=False)
    size_deg: float = Field(default=0.1, allow_inf_nan=False)
    name: str | None = Field(default=None, max_length=120)
    pmra_mas_yr: float | None = Field(default=None, allow_inf_nan=False)
    pmdec_mas_yr: float | None = Field(default=None, allow_inf_nan=False)
    coord_epoch_year: float | None = Field(default=None, ge=1900.0, le=2100.0, allow_inf_nan=False)
    force_refresh: bool = False

    @field_validator("size_deg")
    @classmethod
    def _size(cls, value: float) -> float:
        if value not in SIZE_CHOICES:
            raise ValueError("must be one of 0.05, 0.1, 0.2")
        return value


def _issue(message: str) -> str:
    return message.removeprefix("Value error, ")


def validate_request(raw: bytes) -> NormalizedRequest:
    """Parse and normalize a request body (section 8.2 items 2-4); raises ``ApiError``."""
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise ApiError(400, "malformed_json", "Request body is not valid JSON.") from None
    if not isinstance(body, dict):
        raise ApiError(
            422, "invalid_request", "Request validation failed.",
            [{"field": "", "issue": "must be a JSON object"}],
        )
    try:
        req = JobRequest.model_validate(body)
    except ValidationError as exc:
        details = [
            {"field": ".".join(str(p) for p in err["loc"]), "issue": _issue(err["msg"])}
            for err in exc.errors()
        ]
        raise ApiError(422, "invalid_request", "Request validation failed.", details) from None
    if (req.pmra_mas_yr is None) != (req.pmdec_mas_yr is None):
        missing = "pmdec_mas_yr" if req.pmdec_mas_yr is None else "pmra_mas_yr"
        raise ApiError(
            422, "invalid_request", "Request validation failed.",
            [{"field": missing, "issue": "pmra_mas_yr and pmdec_mas_yr must be given together"}],
        )
    return NormalizedRequest(
        ra_deg=round(req.ra_deg, 6),
        dec_deg=round(req.dec_deg, 6),
        size_deg=req.size_deg,
        name=req.name,
        pmra_mas_yr=req.pmra_mas_yr,
        pmdec_mas_yr=req.pmdec_mas_yr,
        coord_epoch_year=2000.0 if req.coord_epoch_year is None else req.coord_epoch_year,
        coord_epoch_assumed=req.coord_epoch_year is None,
        force_refresh=req.force_refresh,
    )


def job_body(
    job: Job, status: str, cached: bool, joined: bool, request: NormalizedRequest | None = None
) -> dict[str, Any]:
    """DATA_CONTRACT section 11.4 body."""
    return {
        "job_id": job.job_id,
        "slug": job.slug,
        "status": status,
        "cached": cached,
        "joined": joined,
        "created_utc": job.created_utc,
        "events_url": f"/api/jobs/{job.job_id}/events",
        "data_base_url": f"/data/{job.slug}/",
        "request": (request or job.request).as_dict(),
    }


def parse_last_event_id(value: str | None) -> int:
    """Non-negative integer; invalid or missing gives 0 (section 8.3)."""
    if value is None:
        return 0
    text = value.strip()
    return int(text) if text.isascii() and text.isdigit() else 0


async def event_stream(
    request: Request, job: Job, last_event_id: int, retry_ms: int, keepalive_s: int
) -> AsyncIterator[str]:
    yield f"retry: {retry_ms}\n\n"
    cursor = last_event_id
    while True:
        for id_, event, data in job.log.read_from(cursor):
            payload = json.dumps(data, separators=(",", ":"), allow_nan=False, ensure_ascii=False)
            yield f"id: {id_}\nevent: {event}\ndata: {payload}\n\n"
            cursor = id_
        if job.log.terminal and cursor >= job.log.last_id:
            return
        if await request.is_disconnected():
            return
        if not await job.log.wait_for(cursor, timeout=keepalive_s):
            yield ": keepalive\n\n"


# ---------------------------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------------------------


def create_app(loaded: LoadedSettings, manager: JobManager | None = None) -> FastAPI:
    settings, paths = loaded.settings, loaded.paths
    jobs = manager or JobManager(loaded)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        for directory in (paths.data_dir, paths.data_dir / ".locks", paths.cache_dir):
            directory.mkdir(parents=True, exist_ok=True)
        # Startup order (section 8.5): directories, recovery, then the scheduler task.
        closed = jobs.recover()
        if closed:
            log.warning("closed %d interrupted job(s)", closed)
        scheduler = asyncio.create_task(jobs.run_forever())
        try:
            yield
        finally:
            scheduler.cancel()
            await asyncio.gather(scheduler, return_exceptions=True)

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

    @app.post("/api/jobs")
    async def post_job(request: Request) -> JSONResponse:
        media_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
        if media_type != "application/json":
            raise ApiError(415, "unsupported_media_type", "Content-Type must be application/json.")
        normalized = validate_request(await request.body())
        try:
            result: SubmitResult = jobs.submit(normalized)
        except QueueFull as exc:
            raise ApiError(
                429, "queue_full", "The job queue is full; retry later.",
                headers={"Retry-After": str(exc.retry_after_s)},
            ) from None
        body = job_body(result.job, result.status, result.cached, result.joined, normalized)
        return JSONResponse(body, status_code=200 if result.cached else 202)

    @app.get("/api/jobs/{job_id}")
    async def get_job(job_id: str) -> JSONResponse:
        job = jobs.get(job_id)
        if job is None:
            raise not_found("Unknown job.")
        # status == complete iff cached (DC 11.4); a finished job is by definition servable from cache
        return JSONResponse(job_body(job, job.status, job.status == "complete", False))

    @app.get("/api/jobs/{job_id}/events")
    async def get_events(request: Request, job_id: str) -> StreamingResponse:
        job = jobs.get(job_id)
        if job is None:
            raise not_found("Unknown job.")
        last_id = parse_last_event_id(request.headers.get("last-event-id"))
        stream = event_stream(
            request, job, last_id, settings.jobs.sse_retry_ms, settings.jobs.sse_keepalive_s
        )
        return StreamingResponse(
            stream,
            media_type="text/event-stream; charset=utf-8",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error")
        return error_response(ApiError(500, "internal_error", "Internal server error."))

    return app
