"""Frame sampling: cap the exposures fetched per target (BACKEND_SPEC section 6.3.5).

Selection is deterministic. Strata are ``(epoch, detector)`` with epochs from the same
single-linkage function that builds ``frames.json`` (``group.assign_epochs``).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from spherex_backend.group import assign_epochs
from spherex_backend.models import Exposure


@dataclass
class EpochSampling:
    epoch: int
    mjd_start: float
    mjd_end: float
    found: int = 0
    selected: int = 0
    cached_selected: int = 0


@dataclass
class SamplingReport:
    epochs: list[EpochSampling] = field(default_factory=list)
    found: int = 0
    pool: int = 0  # candidates after the cache_only restriction
    selected: int = 0
    cached_selected: int = 0
    cap: int = 0
    cache_only: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "cap": self.cap,
            "cache_only": self.cache_only,
            "found": self.found,
            "pool": self.pool,
            "selected": self.selected,
            "cached_selected": self.cached_selected,
            "epochs": [
                {
                    "epoch": e.epoch,
                    "mjd_start": e.mjd_start,
                    "mjd_end": e.mjd_end,
                    "found": e.found,
                    "selected": e.selected,
                    "cached_selected": e.cached_selected,
                }
                for e in self.epochs
            ],
        }


def evenly_spaced(items: Sequence[Exposure], count: int) -> list[Exposure]:
    """``count`` items at indices ``round(i * (n - 1) / (count - 1))`` (the first for 1)."""
    n = len(items)
    if count <= 0 or n == 0:
        return []
    if count >= n:
        return list(items)
    if count == 1:
        return [items[0]]
    indices = [round(i * (n - 1) / (count - 1)) for i in range(count)]
    return [items[i] for i in indices]


def _sorted_key(e: Exposure) -> tuple[float, str]:
    return (e.mjd, e.source_uri)


def _quotas(sizes: dict[tuple[int, int], int], cap: int, min_per_stratum: int) -> dict[tuple[int, int], int]:
    """Per-stratum quotas summing to ``min(cap, total)``."""
    keys = sorted(sizes)
    if cap < len(keys):  # fewer slots than strata: one each, largest strata first
        largest = sorted(keys, key=lambda k: (-sizes[k], k))[:cap]
        return {k: (1 if k in largest else 0) for k in keys}
    floor = min_per_stratum
    while floor > 1 and sum(min(sizes[k], floor) for k in keys) > cap:
        floor -= 1  # the requested minimum does not fit in the cap; use the largest that does
    quota = {k: min(sizes[k], floor) for k in keys}
    left = cap - sum(quota.values())
    while left > 0:
        open_keys = [k for k in keys if quota[k] < sizes[k]]
        if not open_keys:
            break
        total = sum(sizes[k] for k in open_keys)
        shares = {k: left * sizes[k] / total for k in open_keys}
        add = {k: min(int(shares[k]), sizes[k] - quota[k]) for k in open_keys}
        leftover = left - sum(add.values())
        if leftover > 0:  # largest remainder
            candidates = [k for k in open_keys if quota[k] + add[k] < sizes[k]]
            candidates.sort(key=lambda k: (-(shares[k] - int(shares[k])), -sizes[k], k))
            for k in candidates[:leftover]:
                add[k] += 1
        given = sum(add.values())
        if given == 0:
            break
        for k, n in add.items():
            quota[k] += n
        left -= given
    return quota


def select_exposures(
    exposures: Sequence[Exposure],
    cap: int,
    min_per_stratum: int,
    prefer_cached: bool,
    cache_only: bool,
    epoch_gap_days: float,
    is_cached: Callable[[Exposure], bool],
) -> tuple[list[Exposure], SamplingReport]:
    """Pick at most ``cap`` exposures (``cap <= 0`` means all) and report per-epoch counts."""
    cached_memo: dict[str, bool] = {}

    def cached(e: Exposure) -> bool:
        if e.source_uri not in cached_memo:
            cached_memo[e.source_uri] = is_cached(e)
        return cached_memo[e.source_uri]

    ordered = sorted(exposures, key=_sorted_key)
    epoch_ids, epoch_docs = assign_epochs(
        [{"mjd": e.mjd, "detector": e.detector} for e in ordered], epoch_gap_days
    )
    epoch_of = {e.source_uri: eid for e, eid in zip(ordered, epoch_ids, strict=True)}
    report = SamplingReport(
        epochs=[
            EpochSampling(d["epoch_id"], d["mjd_start"], d["mjd_end"], found=d["n_frames"])
            for d in epoch_docs
        ],
        found=len(ordered),
        cap=cap,
        cache_only=cache_only,
    )

    pool = [e for e in ordered if cached(e)] if cache_only else ordered
    report.pool = len(pool)
    if cap <= 0 or len(pool) <= cap:
        chosen = list(pool)
    else:
        strata: dict[tuple[int, int], list[Exposure]] = {}
        for e in pool:
            strata.setdefault((epoch_of[e.source_uri], e.detector), []).append(e)
        quota = _quotas({k: len(v) for k, v in strata.items()}, cap, min_per_stratum)
        chosen = []
        for key in sorted(strata):
            q = quota[key]
            if q <= 0:
                continue
            rows = strata[key]  # already sorted by (mjd, source_uri)
            if prefer_cached:
                hot = [e for e in rows if cached(e)]
                cold = [e for e in rows if not cached(e)]
                take = min(q, len(hot))
                chosen += evenly_spaced(hot, take) + evenly_spaced(cold, q - take)
            else:
                chosen += evenly_spaced(rows, q)

    chosen.sort(key=lambda e: (e.mjd, e.detector, e.source_uri))
    for e in chosen:
        entry = report.epochs[epoch_of[e.source_uri]]
        entry.selected += 1
        if cached(e):
            entry.cached_selected += 1
    report.selected = len(chosen)
    report.cached_selected = sum(e.cached_selected for e in report.epochs)
    return chosen, report
