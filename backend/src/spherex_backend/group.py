"""Epoch grouping (DATA_CONTRACT section 3.5, BACKEND_SPEC section 6.5)."""

from __future__ import annotations

from typing import Any


def assign_epochs(
    frames: list[dict[str, Any]], gap_days: float
) -> tuple[list[int], list[dict[str, Any]]]:
    """Single-linkage clustering of the frames' ``mjd`` (frames sorted by time).

    Returns each frame's ``epoch_id`` and the ``epochs`` array of frames.json.
    """
    epoch_ids: list[int] = []
    previous: float | None = None
    current = -1
    for frame in frames:
        if previous is None or frame["mjd"] - previous > gap_days:
            current += 1
        previous = frame["mjd"]
        epoch_ids.append(current)

    epochs: list[dict[str, Any]] = []
    for epoch_id in range(current + 1):
        members = [f for f, e in zip(frames, epoch_ids, strict=True) if e == epoch_id]
        mjds = [m["mjd"] for m in members]
        epochs.append(
            {
                "epoch_id": epoch_id,
                "mjd_start": min(mjds),
                "mjd_end": max(mjds),
                "mjd_mean": sum(mjds) / len(mjds),
                "n_frames": len(members),
                "detectors": sorted({m["detector"] for m in members}),
            }
        )
    return epoch_ids, epochs
