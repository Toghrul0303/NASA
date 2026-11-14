"""Job manager (section 7.2): in-memory scheduler over persisted job state."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any

from spherex_backend.config import LoadedSettings
from spherex_backend.events import EventLog
from spherex_backend.models import PipelineError, Target

# Imported at module level on purpose: astropy must configure its logger class before the CLI
# touches logging.getLogger("astropy"); a lazy import inside the worker breaks that order.
from spherex_backend.pipeline import PipelineOutcome, run_pipeline
from spherex_backend.targets import tier2_target

log = logging.getLogger("spherex_backend.jobs")

NON_TERMINAL = ("queued", "running")
CLOSE_GRACE_S = 5.0  # the job is closed at job_timeout_s + this, whatever the worker is doing


class QueueFull(Exception):
    """Queue at capacity (HTTP 429)."""

    def __init__(self, retry_after_s: int) -> None:
        super().__init__("Job queue at capacity.")
        self.retry_after_s = retry_after_s


@dataclass(frozen=True)
class NormalizedRequest:
    """DATA_CONTRACT section 11.2 normalized request."""

    ra_deg: float
    dec_deg: float
    size_deg: float
    name: str | None
    pmra_mas_yr: float | None
    pmdec_mas_yr: float | None
    coord_epoch_year: float
    coord_epoch_assumed: bool
    force_refresh: bool

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    def slug(self) -> str:
        """Section 8.2 item 5, verbatim."""
        pm_a = repr(float(self.pmra_mas_yr)) if self.pmra_mas_yr is not None else "none"
        pm_d = repr(float(self.pmdec_mas_yr)) if self.pmdec_mas_yr is not None else "none"
        request_key = (
            f"{self.ra_deg:.6f}|{self.dec_deg:.6f}|{self.size_deg:.2f}|{pm_a}|{pm_d}"
            f"|{self.coord_epoch_year:.2f}"
        )
        return "c-" + hashlib.sha256(request_key.encode("utf-8")).hexdigest()[:16]

    def target(self) -> Target:
        return tier2_target(
            self.slug(),
            self.ra_deg,
            self.dec_deg,
            self.size_deg,
            self.name,
            self.pmra_mas_yr,
            self.pmdec_mas_yr,
            None if self.coord_epoch_assumed else self.coord_epoch_year,
        )


def utc_now() -> str:
    moment = datetime.now(UTC)
    return f"{moment:%Y-%m-%dT%H:%M:%S}.{moment.microsecond // 1000:03d}Z"


@dataclass
class Job:
    job_id: str
    slug: str
    request: NormalizedRequest
    status: str  # queued | running | complete | failed
    created_utc: str
    log: EventLog
    started: float | None = None  # time.monotonic() when the run began

    def elapsed_s(self) -> float:
        return round(time.monotonic() - self.started, 3) if self.started is not None else 0.0


@dataclass(frozen=True)
class SubmitResult:
    job: Job
    cached: bool
    joined: bool
    status: str  # queued | running | complete


class JobSink:
    """Event sink of a running job: adds ``job_id``/``timestamp_utc``, throttles ``progress``."""

    def __init__(self, job: Job, progress_max_hz: int) -> None:
        self._job = job
        self._min_interval = 1.0 / progress_max_hz if progress_max_hz > 0 else 0.0
        self._last_progress = 0.0

    def emit(self, event: str, payload: dict[str, Any]) -> None:
        if event == "progress":
            now = time.monotonic()
            settled = payload.get("done", 0) + payload.get("failed", 0) >= payload.get("total", 1)
            if not settled and now - self._last_progress < self._min_interval:
                return
            self._last_progress = now
        self._job.log.append(event, payload)  # EventLog adds job_id


class JobManager:
    def __init__(self, loaded: LoadedSettings) -> None:
        self._loaded = loaded
        self._jobs_dir = loaded.paths.cache_dir / "jobs"
        self._by_slug_dir = self._jobs_dir / "by_slug"
        self._data_dir = loaded.paths.data_dir
        self._jobs: dict[str, Job] = {}
        self._queue: list[Job] = []
        self._active: dict[str, Job] = {}  # slug -> queued or running job
        self._lock = threading.Lock()
        self._wakeup: asyncio.Event | None = None
        self._running: set[asyncio.Task[None]] = set()
        self._by_slug_dir.mkdir(parents=True, exist_ok=True)

    # ---- persistence -----------------------------------------------------------------------

    def _job_json(self, job: Job) -> None:
        directory = self._jobs_dir / job.job_id
        directory.mkdir(parents=True, exist_ok=True)
        record = {
            "job_id": job.job_id,
            "slug": job.slug,
            "status": job.status,
            "created_utc": job.created_utc,
            "request": job.request.as_dict(),
        }
        tmp = directory / "job.json.tmp"
        tmp.write_text(json.dumps(record), encoding="utf-8")
        tmp.replace(directory / "job.json")

    def _load_job(self, job_id: str) -> Job | None:
        path = self._jobs_dir / job_id / "job.json"
        if not path.is_file():
            return None
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
            request = NormalizedRequest(**record["request"])
            log_ = EventLog(job_id, path.parent)
            status = str(record["status"])
            if log_.terminal and status in NON_TERMINAL:
                status = "complete" if _terminal_event(log_) == "complete" else "failed"
            return Job(job_id, str(record["slug"]), request, status, str(record["created_utc"]), log_)
        except (OSError, ValueError, KeyError, TypeError):
            log.exception("unreadable job.json", extra={"job_id": job_id})
            return None

    # ---- lifecycle -------------------------------------------------------------------------

    def recover(self) -> int:
        """Section 7.2 startup recovery: close every non-terminal job with ``failed``."""
        closed = 0
        if not self._jobs_dir.is_dir():
            return closed
        for entry in sorted(self._jobs_dir.iterdir()):
            if entry.name == "by_slug" or not (entry / "job.json").is_file():
                continue
            job = self._load_job(entry.name)
            if job is None or job.status not in NON_TERMINAL:
                continue
            job.log.append(
                "failed",
                {
                    "code": "internal_error",
                    "message": "Server restarted.",
                    "retryable": True,
                    "elapsed_s": 0.0,
                },
            )
            job.status = "failed"
            self._job_json(job)
            closed += 1
        return closed

    async def run_forever(self) -> None:
        """Scheduler: start up to ``jobs.max_concurrent_jobs`` jobs at a time."""
        self._wakeup = asyncio.Event()
        self._wakeup.set()  # pick up anything queued before the scheduler started
        limit = self._loaded.settings.jobs.max_concurrent_jobs
        try:
            while True:
                await self._wakeup.wait()
                self._wakeup.clear()
                while True:
                    with self._lock:
                        if len(self._running) >= limit or not self._queue:
                            break
                        job = self._queue.pop(0)
                    task = asyncio.create_task(self._run(job))
                    self._running.add(task)
                    task.add_done_callback(self._finished)
        finally:
            for task in list(self._running):
                task.cancel()

    def _finished(self, task: asyncio.Task[None]) -> None:
        self._running.discard(task)
        if self._wakeup is not None:
            self._wakeup.set()

    def _kick(self) -> None:
        if self._wakeup is not None:
            self._wakeup.set()

    async def _run(self, job: Job) -> None:
        try:
            loaded = self._loaded.effective("tier2")
            job.status = "running"
            job.started = time.monotonic()
            self._job_json(job)
            job.log.append("job_state", {"status": "running", "queue_position": None,
                                         "timestamp_utc": utc_now()})
            deadline = job.started + loaded.settings.jobs.job_timeout_s
            sink = JobSink(job, loaded.settings.jobs.progress_max_hz)
            outcome = await self._run_bounded(
                job, sink, deadline, loaded, deadline + CLOSE_GRACE_S
            )
        except PipelineError as exc:
            self._fail(job, exc.code, exc.message, exc.retryable)
        except asyncio.CancelledError:
            self._fail(job, "internal_error", "Server shutting down.", True)
            raise
        except Exception as exc:  # defensive: run_pipeline already wraps its own errors
            log.exception("job failed", extra={"job_id": job.job_id, "slug": job.slug})
            self._fail(job, "internal_error", f"{type(exc).__name__}: {exc}", False)
        else:
            job.status = "complete"
            job.log.append(
                "complete",
                {
                    "slug": outcome.slug,
                    "result_status": outcome.result_status,
                    "data_base_url": f"/data/{outcome.slug}/",
                    "data_version": outcome.data_version,
                    "n_frames": outcome.n_frames,
                    "n_epochs": outcome.n_epochs,
                    "n_failed_fetches": outcome.n_failed_fetches,
                    "files": outcome.files,
                    "elapsed_s": outcome.elapsed_s,
                },
            )
            self._write_by_slug(job.slug, job.job_id)
        finally:
            self._job_json(job)
            with self._lock:
                self._active.pop(job.slug, None)

    async def _run_bounded(
        self, job: Job, sink: JobSink, deadline: float, loaded: LoadedSettings, hard_stop: float
    ) -> PipelineOutcome:
        """Run the pipeline on a daemon thread; give up at ``hard_stop`` whatever it is doing.

        The thread cannot be killed. Once abandoned it can neither append events (the log is
        terminal) nor publish data (``export`` refuses after ``deadline``, which precedes
        ``hard_stop``).
        """
        loop = asyncio.get_running_loop()
        future: asyncio.Future[PipelineOutcome] = loop.create_future()

        def settle(setter: Callable[[Any], None], value: Any) -> None:
            if not future.done():
                setter(value)

        def work() -> None:
            try:
                outcome = run_pipeline(
                    job.request.target(), sink, deadline, loaded=loaded, job_id=job.job_id
                )
            except BaseException as exc:
                loop.call_soon_threadsafe(settle, future.set_exception, exc)
            else:
                loop.call_soon_threadsafe(settle, future.set_result, outcome)

        threading.Thread(target=work, name=f"job-{job.job_id}", daemon=True).start()
        done, _ = await asyncio.wait({future}, timeout=max(hard_stop - time.monotonic(), 0.0))
        if not done:
            future.cancel()
            raise PipelineError("timeout", "The job exceeded its time limit.", retryable=True)
        return future.result()

    def _fail(self, job: Job, code: str, message: str, retryable: bool) -> None:
        job.status = "failed"
        job.log.append(
            "failed",
            {"code": code, "message": message, "retryable": retryable, "elapsed_s": job.elapsed_s()},
        )

    # ---- submit ----------------------------------------------------------------------------

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is not None:
            return job
        job = self._load_job(job_id)
        if job is not None:
            with self._lock:
                job = self._jobs.setdefault(job_id, job)
        return job

    def _write_by_slug(self, slug: str, job_id: str) -> None:
        (self._by_slug_dir / f"{slug}.json").write_text(json.dumps({"job_id": job_id}), encoding="utf-8")

    def _cached_meta(self, slug: str) -> dict[str, Any] | None:
        path = self._data_dir / slug / "meta.json"
        try:
            meta = json.loads(path.read_text(encoding="utf-8"))
            created = datetime.strptime(meta["created_utc"], "%Y-%m-%dT%H:%M:%S.%fZ")
        except (OSError, ValueError, KeyError):
            return None
        if meta.get("status") != "complete":
            return None
        age_h = (datetime.now(UTC) - created.replace(tzinfo=UTC)).total_seconds() / 3600.0
        if age_h >= self._loaded.settings.jobs.cache_ttl_hours:
            return None
        return meta

    def _cached_job(self, request: NormalizedRequest, slug: str, meta: dict[str, Any]) -> Job:
        """The job that produced the cached result, with its events synthesized if gone."""
        job_id: str | None = None
        by_slug = self._by_slug_dir / f"{slug}.json"
        try:
            job_id = str(json.loads(by_slug.read_text(encoding="utf-8"))["job_id"])
        except (OSError, ValueError, KeyError):
            pass
        job = self.get(job_id) if job_id else None
        if job is not None and not self._produced(job, slug):
            job, job_id = None, None
        if job is None:  # no record (for example `build-coord`): mint one for the cached result
            job_id = job_id or "j_" + secrets.token_hex(8)
            directory = self._jobs_dir / job_id
            job = Job(job_id, slug, request, "complete", meta["created_utc"], EventLog(job_id, directory))
            self._job_json(job)
            with self._lock:
                self._jobs[job_id] = job
        if not job.log.terminal:
            self._synthesize(job, meta)
        job.status = "complete" if _terminal_event(job.log) == "complete" else job.status
        self._write_by_slug(slug, job.job_id)
        return job

    def _produced(self, job: Job, slug: str) -> bool:
        """True when ``job``'s stream is a usable record of the directory now on disk.

        A non-terminal log is fine (it is synthesized). A terminal log must end in ``complete``
        and carry the sha256 of the current ``meta.json``; otherwise a later build (for example
        ``build-coord --force``) replaced the result and the old stream would be stale.
        """
        if not job.log.terminal:
            return True
        last: tuple[int, str, dict[str, Any]] | None = None
        for last in job.log.read_from(max(job.log.last_id - 1, 0)):
            pass
        if last is None or last[1] != "complete":
            return False
        listed = last[2].get("files", {}).get("meta.json", {}).get("sha256")
        raw = (self._data_dir / slug / "meta.json").read_bytes()
        return listed == hashlib.sha256(raw).hexdigest()

    def _synthesize(self, job: Job, meta: dict[str, Any]) -> None:
        """DC section 12.2: a cached job's stream is ``job_state(complete)`` then ``complete``."""
        slug = job.slug
        meta_path = self._data_dir / slug / "meta.json"
        raw = meta_path.read_bytes()
        files = dict(meta["files"])
        files["meta.json"] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        obs = meta["observations"]
        job.log.append("job_state", {"status": "complete", "queue_position": None,
                                     "timestamp_utc": utc_now()})
        job.log.append(
            "complete",
            {
                "slug": slug,
                "result_status": meta["status"],
                "data_base_url": f"/data/{slug}/",
                "data_version": meta["data_version"],
                "n_frames": obs["n_frames"],
                "n_epochs": obs["n_epochs"],
                "n_failed_fetches": obs["n_failed_fetches"],
                "files": files,
                "elapsed_s": 0.0,  # the original duration is not recorded in meta.json
            },
        )

    def submit(self, request: NormalizedRequest) -> SubmitResult:
        """DATA_CONTRACT section 11.4 semantics (BACKEND_SPEC section 7.2)."""
        slug = request.slug()
        jobs_cfg = self._loaded.settings.jobs
        if not request.force_refresh:
            meta = self._cached_meta(slug)
            if meta is not None:
                with self._lock:
                    live = self._active.get(slug)
                if live is None:
                    return SubmitResult(self._cached_job(request, slug, meta), True, False, "complete")
        with self._lock:
            live = self._active.get(slug)
            if live is not None:
                return SubmitResult(live, False, True, live.status)
            if len(self._queue) + len(self._running) >= jobs_cfg.max_concurrent_jobs + jobs_cfg.queue_capacity:
                raise QueueFull(jobs_cfg.retry_after_s)
            job_id = "j_" + secrets.token_hex(8)
            job = Job(job_id, slug, request, "queued", utc_now(), EventLog(job_id, self._jobs_dir / job_id))
            self._jobs[job_id] = job
            self._active[slug] = job
            position = len(self._queue) + 1
            self._queue.append(job)
        self._job_json(job)
        job.log.append("job_state", {"status": "queued", "queue_position": position,
                                     "timestamp_utc": job.created_utc})
        self._kick()
        return SubmitResult(job, False, False, "queued")


def _terminal_event(log_: EventLog) -> str | None:
    last: str | None = None
    for _, event, _ in log_.read_from(max(log_.last_id - 1, 0)):
        last = event
    return last
