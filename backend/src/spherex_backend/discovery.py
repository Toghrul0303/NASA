"""IRSA TAP discovery of SPHEREx exposures (BACKEND_SPEC section 6.3.2)."""

from __future__ import annotations

import hashlib
import json
import math
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from spherex_backend.bounded import CallTimeout, TimeoutSession, call_with_timeout, remaining_s
from spherex_backend.config import IrsaConfig
from spherex_backend.models import Exposure, PipelineError, Target
from spherex_backend.timeutil import propagate

ADQL_TEMPLATE = (
    "SELECT a.uri, p.time_bounds_lower, p.energy_bandpassname "
    "FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid "
    "WHERE 1 = CONTAINS(POINT('ICRS', {ra}, {dec}), p.poly) "
    "ORDER BY p.time_bounds_lower"
)
_VERSION = re.compile(r"v(\d+)-(\d{4})-(\d{3})")
_DETECTOR = re.compile(r"SPHEREx-D(\d)")
MJD_MIN, MJD_MAX = 60000.0, 70000.0


@dataclass(frozen=True)
class TapRow:
    uri: str
    time_bounds_lower: float | None
    energy_bandpassname: str


class DiscoveryClient(Protocol):
    def query(self, ra_deg: float, dec_deg: float) -> list[TapRow]: ...


@dataclass(frozen=True)
class Candidate:
    base_uri: str
    frame_key: str
    release: str
    detector: int
    mjd: float | None


@dataclass
class DiscoveryResult:
    candidates: list[Candidate]  # de-duplicated, valid mjd
    invalid: list[Candidate]  # de-duplicated, mjd outside 60000-70000 or missing
    n_found: int  # rows after release filtering, before de-duplication
    t_mid: float
    center: tuple[float, float]
    tap_elapsed_s: float


class PyvoDiscoveryClient:
    """Synchronous IRSA TAP queries with retries and a disk cache."""

    def __init__(
        self,
        irsa: IrsaConfig,
        cache_dir: Path,
        sleep: Callable[[float], None] = time.sleep,
        deadline: float | None = None,
    ) -> None:
        self._irsa = irsa
        self._dir = cache_dir / "tap"
        self._sleep = sleep
        self._deadline = deadline  # time.monotonic() value of the job deadline

    def query(self, ra_deg: float, dec_deg: float) -> list[TapRow]:
        adql = ADQL_TEMPLATE.format(ra=f"{ra_deg:.9f}", dec=f"{dec_deg:.9f}")
        key = hashlib.sha256(f"{self._irsa.tap_url}|{adql}".encode()).hexdigest()
        path = self._dir / f"{key}.json"
        cached = self._read_cache(path)
        if cached is not None:
            return cached
        rows = self._run(adql)
        self._write_cache(path, rows)
        return rows

    def _read_cache(self, path: Path) -> list[TapRow] | None:
        try:
            if time.time() - path.stat().st_mtime > self._irsa.tap_cache_ttl_s:
                return None
            raw = json.loads(path.read_text(encoding="utf-8"))
            return [TapRow(r[0], r[1], r[2]) for r in raw]
        except (OSError, ValueError, IndexError, TypeError):
            return None

    def _write_cache(self, path: Path, rows: list[TapRow]) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps([[r.uri, r.time_bounds_lower, r.energy_bandpassname] for r in rows]),
            encoding="utf-8",
        )
        tmp.replace(path)

    def _attempt(self, adql: str) -> list[TapRow]:
        import pyvo

        timeout = float(self._irsa.tap_timeout_s)
        # Socket-level timeouts: pyvo's own ``timeout`` only bounds job polling, the initial
        # POST would otherwise wait forever on a server that never answers.
        session = TimeoutSession(min(timeout, 10.0), timeout)
        service = pyvo.dal.TAPService(self._irsa.tap_url, session=session)
        table = service.run_sync(adql, timeout=timeout).to_table()
        rows: list[TapRow] = []
        for rec in table:
            mjd_raw = rec["time_bounds_lower"]
            masked = bool(getattr(mjd_raw, "mask", False))
            mjd = None if masked or not math.isfinite(float(mjd_raw)) else float(mjd_raw)
            rows.append(TapRow(str(rec["uri"]), mjd, str(rec["energy_bandpassname"])))
        return rows

    def _run(self, adql: str) -> list[TapRow]:
        last: Exception | None = None
        for attempt in range(1, self._irsa.tap_retries + 1):
            left = remaining_s(self._deadline)
            if left is not None and left <= 0:
                raise PipelineError("timeout", "The job exceeded its time limit.", retryable=True)
            # Hard bound per attempt: the tier-2 TAP timeout (+ slack for the result transfer),
            # never beyond the job deadline. A thread that cannot be interrupted is abandoned;
            # its late result is dropped because caching happens in the caller.
            bound = float(self._irsa.tap_timeout_s) + 5.0
            if left is not None:
                bound = min(bound, left)
            try:
                return call_with_timeout(lambda: self._attempt(adql), bound, "irsa-tap")
            except Exception as exc:  # pyvo raises several unrelated exception types
                last = exc
                if isinstance(exc, CallTimeout) and left is not None and bound >= left:
                    raise PipelineError(
                        "timeout", "The job exceeded its time limit.", retryable=True
                    ) from exc
                if attempt < self._irsa.tap_retries:
                    pause = self._irsa.tap_backoff_s * attempt
                    after = remaining_s(self._deadline)
                    self._sleep(pause if after is None else max(min(pause, after), 0.0))
        raise PipelineError(
            "upstream_unavailable", f"IRSA TAP query failed: {last}", retryable=True
        )


def _stem(uri: str) -> str:
    name = uri.split("?", 1)[0].rsplit("/", 1)[-1]
    return name[:-5] if name.lower().endswith(".fits") else name


def to_candidates(rows: list[TapRow], irsa: IrsaConfig) -> list[Candidate]:
    """Release filter, detector parse and absolute URI (rules 2-4)."""
    out: list[Candidate] = []
    for row in rows:
        base = row.uri if "://" in row.uri else irsa.uri_prefix + row.uri.lstrip("/")
        base = base.split("?", 1)[0]
        release = next(
            (r for r in irsa.releases if irsa.release_path_pattern.format(release=r) in base),
            None,
        )
        match = _DETECTOR.search(row.energy_bandpassname)
        if release is None or match is None:
            continue
        out.append(Candidate(base, _stem(base), release, int(match.group(1)), row.time_bounds_lower))
    return out


def deduplicate(candidates: list[Candidate]) -> list[Candidate]:
    """Keep the latest processing version per exposure (rule 5)."""
    best: dict[str, tuple[tuple[tuple[int, int, int], str], Candidate]] = {}
    for cand in candidates:
        prefix, sep, rest = cand.frame_key.partition("_spx_")
        found = _VERSION.search(rest if sep else cand.frame_key)
        version = (
            (int(found.group(1)), int(found.group(2)), int(found.group(3)))
            if found
            else (-1, -1, -1)
        )
        rank = (version, cand.frame_key)
        current = best.get(prefix)
        if current is None or rank > current[0]:
            best[prefix] = (rank, cand)
    return sorted((v[1] for v in best.values()), key=lambda c: (c.mjd or 0.0, c.frame_key))


def separation_arcsec(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle separation of two ``(ra_deg, dec_deg)`` points in arcsec."""
    ra1, dec1, ra2, dec2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    d_ra = ra2 - ra1
    num = math.hypot(
        math.cos(dec2) * math.sin(d_ra),
        math.cos(dec1) * math.sin(dec2) - math.sin(dec1) * math.cos(dec2) * math.cos(d_ra),
    )
    den = math.sin(dec1) * math.sin(dec2) + math.cos(dec1) * math.cos(dec2) * math.cos(d_ra)
    return math.degrees(math.atan2(num, den)) * 3600.0


def _discover_at(
    client: DiscoveryClient, target: Target, irsa: IrsaConfig, position: tuple[float, float]
) -> tuple[int, list[Candidate], list[Candidate]]:
    rows = client.query(*position)
    filtered = to_candidates(rows, irsa)
    unique = deduplicate(filtered)
    valid = [c for c in unique if c.mjd is not None and MJD_MIN <= c.mjd <= MJD_MAX]
    invalid = [c for c in unique if c not in valid]
    return len(filtered), valid, invalid


def discover(client: DiscoveryClient, target: Target, irsa: IrsaConfig) -> DiscoveryResult:
    """Steps 1-8 and 10 of section 6.3.2 (proper-motion adoption happens afterwards)."""
    started = time.monotonic()
    first = propagate(target, irsa.discovery_epoch_mjd)
    n_found, valid, invalid = _discover_at(client, target, irsa, first)
    if not valid and not invalid:
        raise PipelineError(
            "no_coverage",
            "No SPHEREx exposures overlap this position in the configured releases.",
            retryable=False,
        )
    t_mid = _t_mid(valid, invalid)
    center = propagate(target, t_mid)
    if separation_arcsec(first, center) > irsa.rediscovery_threshold_arcsec:
        n_found, valid, invalid = _discover_at(client, target, irsa, center)
        if not valid and not invalid:
            raise PipelineError(
                "no_coverage",
                "No SPHEREx exposures overlap this position in the configured releases.",
                retryable=False,
            )
        t_mid = _t_mid(valid, invalid)
        center = propagate(target, t_mid)
    return DiscoveryResult(valid, invalid, n_found, t_mid, center, time.monotonic() - started)


def _t_mid(valid: list[Candidate], invalid: list[Candidate]) -> float:
    mjds = [c.mjd for c in valid if c.mjd is not None]
    if not mjds:
        raise PipelineError(
            "no_coverage", "Every overlapping exposure has an invalid observation time.", False
        )
    return (min(mjds) + max(mjds)) / 2.0


def cutout_url(irsa: IrsaConfig, base_uri: str, ra: float, dec: float, size_deg: float) -> str:
    return irsa.cutout_query_template.format(
        uri=base_uri, ra=ra, dec=dec, size=size_deg + 2 * irsa.cutout_margin_deg
    )


def build_exposures(
    target: Target, candidates: list[Candidate], irsa: IrsaConfig
) -> list[Exposure]:
    """Attach per-exposure cutout centres and URLs (end of section 6.3.2)."""
    exposures: list[Exposure] = []
    for cand in candidates:
        assert cand.mjd is not None
        ra, dec = propagate(target, cand.mjd)
        exposures.append(
            Exposure(
                source_uri=cutout_url(irsa, cand.base_uri, ra, dec, target.size_deg),
                base_uri=cand.base_uri,
                frame_key=cand.frame_key,
                release=cand.release,  # type: ignore[arg-type]
                detector=cand.detector,
                mjd=cand.mjd,
                cutout_ra_deg=ra,
                cutout_dec_deg=dec,
            )
        )
    return exposures


def invalid_uris(target: Target, invalid: list[Candidate], irsa: IrsaConfig) -> list[str]:
    ra, dec = propagate(target, irsa.discovery_epoch_mjd)
    return [cutout_url(irsa, c.base_uri, ra, dec, target.size_deg) for c in invalid]


def data_version(exposures: list[Exposure]) -> str:
    """DATA_CONTRACT section 5.3 invariant 8."""
    text = "\n".join(sorted(e.source_uri for e in exposures))
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()
