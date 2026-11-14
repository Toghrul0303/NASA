"""Cutout download: requests, bounded time, retries, host breaker, disk cache (section 6.4.2)."""

from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import random
import re
import threading
import time
import uuid
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import requests
from astropy.io import fits
from filelock import FileLock, Timeout
from requests.adapters import HTTPAdapter

from spherex_backend.config import BreakerConfig, HttpConfig, IrsaConfig, LoadedSettings
from spherex_backend.models import Exposure

log = logging.getLogger("spherex.fetch")
CHUNK_BYTES = 64 * 1024
FetchStatus = Literal["ok", "failed", "skipped_breaker", "skipped_deadline"]

FETCH_SEMAPHORE = threading.BoundedSemaphore(8)
_semaphore_size = 8
_semaphore_lock = threading.Lock()
_irsa: IrsaConfig | None = None
_local = threading.local()


class FetchError(Exception):
    """Kept for callers that want an exception; ``fetch_cutout`` itself returns a result."""


@dataclass(frozen=True)
class FetchResult:
    path: Path | None
    status: FetchStatus
    attempts: int = 0
    message: str = ""
    group: str = ""
    retryable: bool = True  # False for permanent errors (other 4xx, invalid FITS): no backfill


# --------------------------------------------------------------------------- #
# Host breaker
# --------------------------------------------------------------------------- #


@dataclass
class _Group:
    outcomes: deque[bool]
    consecutive: int = 0
    is_open: bool = False
    opened_wall: float = 0.0
    last_probe: float = 0.0  # monotonic time of the last allowed probe (or of opening)


def _default_breaker_config() -> BreakerConfig:
    return BreakerConfig(
        enabled=True,
        group_regex=r"/(?P<rel>dr1|qr3)/level2/(?P<week>\d{4}W\d{2}_\d[A-Z])/",
        consecutive_failures=5,
        window=10,
        window_failures=8,
        cooldown_s=45,
        persist_path="cache/breaker.json",
        persist_ttl_s=1800,
    )


class HostBreaker:
    """Thread-safe circuit breaker keyed by release and observing week.

    A group opens after ``consecutive_failures`` failures in a row or ``window_failures``
    failures among the last ``window`` attempts; one success closes it. While open and
    ``cooldown_s > 0`` one probe attempt is allowed per cooldown period (half-open).
    """

    def __init__(
        self,
        cfg: BreakerConfig | None = None,
        path: Path | None = None,
        *,
        clock: Callable[[], float] = time.monotonic,
        wall: Callable[[], float] = time.time,
    ) -> None:
        self._lock = threading.RLock()
        self._clock = clock
        self._wall = wall
        self._groups: dict[str, _Group] = {}
        self._cfg = cfg or _default_breaker_config()
        self._regex = re.compile(self._cfg.group_regex)
        self._path = path
        if path is not None:
            self._load()

    # -- configuration --------------------------------------------------------------------
    def configure(self, cfg: BreakerConfig, path: Path | None) -> None:
        with self._lock:
            if cfg == self._cfg and path == self._path:
                return
            self._cfg = cfg
            self._regex = re.compile(cfg.group_regex)
            self._path = path
            for group in self._groups.values():
                group.outcomes = deque(group.outcomes, maxlen=cfg.window)
            if path is not None:
                self._load()

    def group_key(self, uri: str) -> str:
        match = self._regex.search(uri)
        if match is None:
            return "other"
        names = match.groupdict()
        if "rel" in names and "week" in names and names["rel"] and names["week"]:
            return f"{names['rel']}/{names['week']}"
        return match.group(0).strip("/") or "other"

    # -- state ----------------------------------------------------------------------------
    def state(self, group: str) -> Literal["open", "closed"]:
        with self._lock:
            entry = self._groups.get(group)
            return "open" if entry is not None and entry.is_open else "closed"

    def is_open(self, group: str) -> bool:
        return self.state(group) == "open"

    def probe_allowed(
        self, group: str, force: bool = False, cooldown_s: float | None = None
    ) -> bool:
        """True when a request to ``group`` may proceed. Consumes the half-open probe token."""
        with self._lock:
            entry = self._groups.get(group)
            if entry is None or not entry.is_open:
                return True
            if force:
                entry.last_probe = self._clock()
                return True
            cooldown = self._cfg.cooldown_s if cooldown_s is None else cooldown_s
            if cooldown <= 0:
                return False
            now = self._clock()
            if now - entry.last_probe >= cooldown:
                entry.last_probe = now
                return True
            return False

    def record(self, group: str, ok: bool) -> None:
        """Record one retryable attempt outcome (permanent errors are never recorded)."""
        with self._lock:
            entry = self._groups.get(group)
            if entry is None:
                entry = _Group(outcomes=deque(maxlen=self._cfg.window))
                self._groups[group] = entry
            entry.outcomes.append(ok)
            if ok:
                entry.consecutive = 0
                if entry.is_open:
                    entry.is_open = False
                    entry.outcomes.clear()
                    log.warning("[breaker] closed %s", group, extra={"stage": "fetch_process"})
                    self._persist()
                return
            entry.consecutive += 1
            failures = sum(1 for o in entry.outcomes if not o)
            if not entry.is_open and (
                entry.consecutive >= self._cfg.consecutive_failures
                or failures >= self._cfg.window_failures
            ):
                entry.is_open = True
                entry.opened_wall = self._wall()
                entry.last_probe = self._clock()
                log.warning("[breaker] opened %s", group, extra={"stage": "fetch_process"})
                self._persist()

    def open_groups(self) -> list[str]:
        with self._lock:
            return sorted(g for g, e in self._groups.items() if e.is_open)

    def reset(self) -> None:
        """Forget every group and delete the persisted file."""
        with self._lock:
            self._groups.clear()
            if self._path is not None:
                try:
                    with FileLock(str(self._path) + ".lock", timeout=5):
                        self._path.unlink(missing_ok=True)
                except (OSError, Timeout):
                    log.warning("could not clear %s", self._path)

    # -- persistence ----------------------------------------------------------------------
    def _persist(self) -> None:
        if self._path is None:
            return
        payload = {
            g: {"opened_at": e.opened_wall} for g, e in self._groups.items() if e.is_open
        }
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            with FileLock(str(self._path) + ".lock", timeout=5):
                if payload:
                    tmp = self._path.with_suffix(".tmp")
                    tmp.write_text(json.dumps(payload), encoding="utf-8")
                    os.replace(tmp, self._path)
                else:
                    self._path.unlink(missing_ok=True)
        except (OSError, Timeout) as exc:
            log.warning("could not persist breaker state: %s", exc)

    def _load(self) -> None:
        assert self._path is not None
        try:
            with FileLock(str(self._path) + ".lock", timeout=5):
                raw = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError, Timeout):
            return
        if not isinstance(raw, dict):
            return
        now_wall = self._wall()
        for group, info in raw.items():
            try:
                opened = float(info["opened_at"])
            except (KeyError, TypeError, ValueError):
                continue
            if now_wall - opened > self._cfg.persist_ttl_s:
                continue
            entry = self._groups.setdefault(group, _Group(outcomes=deque(maxlen=self._cfg.window)))
            entry.is_open = True
            entry.opened_wall = opened
            entry.last_probe = self._clock()
            log.warning("[breaker] opened %s (restored)", group, extra={"stage": "fetch_process"})


BREAKER = HostBreaker()


def breaker_path(loaded: LoadedSettings) -> Path:
    """``irsa.breaker.persist_path``; relative paths resolve against ``paths.cache_dir.parent``."""
    path = Path(loaded.settings.irsa.breaker.persist_path)
    return path if path.is_absolute() else (loaded.paths.cache_dir.parent / path).resolve()


def configure(irsa: IrsaConfig, breaker_file: Path | None = None) -> None:
    """Size the process-wide semaphore and set the module defaults and the breaker.

    The semaphore is replaced only when the size changes, so concurrent jobs keep sharing it.
    """
    global FETCH_SEMAPHORE, _semaphore_size, _irsa
    with _semaphore_lock:
        if irsa.max_concurrent_fetches != _semaphore_size:
            FETCH_SEMAPHORE = threading.BoundedSemaphore(irsa.max_concurrent_fetches)
            _semaphore_size = irsa.max_concurrent_fetches
        _irsa = irsa
    BREAKER.configure(irsa.breaker, breaker_file)


# --------------------------------------------------------------------------- #
# Download
# --------------------------------------------------------------------------- #


def cache_path(cache_dir: Path, source_uri: str) -> Path:
    digest = hashlib.sha256(source_uri.encode("utf-8")).hexdigest()
    return cache_dir / "cutouts" / digest[:2] / f"{digest}.fits"


class _Retryable(Exception):
    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class _Permanent(Exception):
    """Not retried and not counted toward the breaker."""


_PERMANENT_REQUEST_ERRORS = (
    requests.exceptions.InvalidURL,
    requests.exceptions.InvalidSchema,
    requests.exceptions.MissingSchema,
    requests.exceptions.InvalidHeader,
    requests.exceptions.TooManyRedirects,
    requests.exceptions.URLRequired,
)


def _session() -> requests.Session:
    """One keep-alive session per worker thread."""
    session = getattr(_local, "session", None)
    if session is None:
        session = requests.Session()
        adapter = HTTPAdapter(pool_connections=2, pool_maxsize=2, max_retries=0)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        _local.session = session
    return session


def _retry_after(value: str | None, cap: float) -> float:
    try:
        seconds = float(value) if value is not None else cap
    except ValueError:
        seconds = cap
    return max(0.0, min(seconds, cap))


def _get_bytes(source_uri: str, http: HttpConfig) -> bytes:
    started = time.monotonic()
    try:
        response = _session().get(
            source_uri, stream=True, timeout=(http.connect_timeout_s, http.read_timeout_s)
        )
    except _PERMANENT_REQUEST_ERRORS as exc:
        raise _Permanent(f"{type(exc).__name__}: {exc}") from exc
    except (requests.Timeout, requests.ConnectionError, requests.exceptions.ChunkedEncodingError) as exc:
        raise _Retryable(f"{type(exc).__name__}: {exc}") from exc
    except OSError as exc:
        raise _Retryable(f"{type(exc).__name__}: {exc}") from exc
    with response:
        code = response.status_code
        if code == 429:
            raise _Retryable(
                "HTTP 429", _retry_after(response.headers.get("Retry-After"), http.retry_after_cap_s)
            )
        if 500 <= code < 600:
            raise _Retryable(f"HTTP {code}")
        if code >= 400:
            raise _Permanent(f"HTTP {code}")
        chunks: list[bytes] = []
        try:
            for chunk in response.iter_content(CHUNK_BYTES):
                chunks.append(chunk)
                if time.monotonic() - started > http.total_timeout_s:
                    raise _Retryable(f"download exceeded {http.total_timeout_s:g} s")
        except _PERMANENT_REQUEST_ERRORS as exc:
            raise _Permanent(f"{type(exc).__name__}: {exc}") from exc
        except (requests.RequestException, OSError) as exc:
            raise _Retryable(f"{type(exc).__name__}: {exc}") from exc
        data = b"".join(chunks)
        expected = response.headers.get("Content-Length")
        if expected is not None and expected.isdigit() and int(expected) != len(data):
            raise _Retryable(f"truncated body: {len(data)} of {expected} bytes")
        return data


def _store(data: bytes, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f"{destination.name}.{uuid.uuid4().hex}.part")
    try:
        try:
            with fits.open(io.BytesIO(data), cache=False) as hdul:
                if "IMAGE" not in hdul:
                    raise _Permanent("cutout has no IMAGE extension")
                hdul.writeto(temporary, overwrite=True)
        except _Permanent:
            raise
        except Exception as exc:  # astropy raises several unrelated types for bad FITS
            raise _Permanent(f"invalid FITS: {type(exc).__name__}: {exc}") from exc
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def fetch_cutout(
    exposure: Exposure,
    cache_dir: Path,
    on_retry: Callable[[int], None],
    *,
    breaker: HostBreaker,
    fetch_deadline: float | None,
    irsa: IrsaConfig | None = None,
    force_probe: bool = False,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> FetchResult:
    """Return the cached cutout, downloading it first when needed.

    Order: cache hit, deadline, breaker, semaphore, deadline and breaker again, then up to
    ``irsa.fetch_retries`` attempts. ``fetch_deadline`` is a ``time.monotonic()`` value.
    ``force_probe`` (backfill) sends one full retry cycle even through an open breaker.
    """
    cfg = irsa or _irsa
    if cfg is None:
        raise RuntimeError("fetch.configure() has not been called")
    path = cache_path(cache_dir, exposure.source_uri)
    if path.is_file():
        return FetchResult(path, "ok", 0)

    def expired() -> bool:
        return fetch_deadline is not None and clock() >= fetch_deadline

    group = breaker.group_key(exposure.source_uri)
    use_breaker = cfg.breaker.enabled
    cooldown = cfg.breaker.cooldown_s
    skipped_deadline = FetchResult(None, "skipped_deadline", 0, "fetch budget exhausted", group)
    skipped_breaker = FetchResult(None, "skipped_breaker", 0, f"IRSA unresponsive for {group}", group)

    if expired():
        return skipped_deadline
    probe = False
    if use_breaker and breaker.is_open(group):
        if not breaker.probe_allowed(group, force=force_probe, cooldown_s=cooldown):
            return skipped_breaker
        probe = True

    with FETCH_SEMAPHORE:  # looked up at call time so configure() takes effect
        if expired():
            return skipped_deadline
        if use_breaker and not probe and breaker.is_open(group):
            if not breaker.probe_allowed(group, force=force_probe, cooldown_s=cooldown):
                return skipped_breaker
            probe = True
        # A half-open probe is a single attempt; a forced (backfill) probe is a full cycle.
        max_attempts = 1 if (probe and not force_probe) else cfg.fetch_retries
        last = "no attempt made"
        for attempt in range(1, max_attempts + 1):
            retry_after: float | None = None
            try:
                data = _get_bytes(exposure.source_uri, cfg.http)
                _store(data, path)
            except _Permanent as exc:
                return FetchResult(None, "failed", attempt, str(exc), group, retryable=False)
            except _Retryable as exc:
                last, retry_after = str(exc), exc.retry_after
                if use_breaker:
                    breaker.record(group, False)
            else:
                if use_breaker:
                    breaker.record(group, True)
                return FetchResult(path, "ok", attempt, "", group)
            if attempt >= max_attempts:
                break
            if expired():
                return FetchResult(None, "skipped_deadline", attempt, last, group)
            if use_breaker and not probe and breaker.is_open(group):
                return FetchResult(None, "failed", attempt, f"{last} (breaker opened)", group)
            on_retry(attempt)
            if retry_after is not None:
                sleep(retry_after)
            else:
                sleep(cfg.fetch_backoff_s * attempt + random.uniform(0.0, cfg.fetch_jitter_s))
        return FetchResult(None, "failed", max_attempts, last, group)
