"""Job event log (section 7.1): persisted JSON lines with ids, replay and async waiters."""

from __future__ import annotations

import asyncio
import json
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any

TERMINAL_EVENTS = frozenset({"complete", "failed"})


class EventLog:
    """Append-only event log of one job.

    ``append`` may be called from a worker thread; ``wait_for`` is awaited on the event loop.
    Ids are assigned under a lock, the line is flushed to ``events.jsonl`` and only then are
    waiters notified, so a woken reader always finds the event on disk.
    """

    def __init__(self, job_id: str, dir: Path) -> None:
        self.job_id = job_id
        self._path = dir / "events.jsonl"
        self._lock = threading.Lock()
        self._offsets: list[int] = []  # byte offset of event id n at index n - 1
        self._size = 0
        self._waiters: list[tuple[asyncio.AbstractEventLoop, asyncio.Event]] = []
        self.terminal = False
        dir.mkdir(parents=True, exist_ok=True)
        self._recover()

    def _recover(self) -> None:
        """Index an existing file (finished jobs, restarts); a torn last line is ignored."""
        if not self._path.is_file():
            return
        offset = 0
        last_event: str | None = None
        with self._path.open("rb") as handle:
            for line in handle:
                if not line.endswith(b"\n"):
                    break
                try:
                    record = json.loads(line)
                    last_event = str(record["event"])
                except (ValueError, KeyError):
                    break
                self._offsets.append(offset)
                offset += len(line)
        self._size = offset
        self.terminal = last_event in TERMINAL_EVENTS
        if self._path.stat().st_size != offset:  # drop a partial trailing record
            with self._path.open("r+b") as handle:
                handle.truncate(offset)

    @property
    def last_id(self) -> int:
        return len(self._offsets)

    def append(self, event: str, data: dict[str, Any]) -> int:
        """Assign ``id = previous + 1``, persist, notify waiters; returns the id."""
        with self._lock:
            if self.terminal:  # a closed job (for example on timeout) accepts no late events
                return len(self._offsets)
            payload = {"job_id": self.job_id, **data}
            event_id = len(self._offsets) + 1
            line = json.dumps(
                {"id": event_id, "event": event, "data": payload},
                separators=(",", ":"),
                allow_nan=False,
                ensure_ascii=False,
            )
            encoded = (line + "\n").encode("utf-8")
            with self._path.open("ab") as handle:
                handle.write(encoded)
                handle.flush()
            self._offsets.append(self._size)
            self._size += len(encoded)
            if event in TERMINAL_EVENTS:
                self.terminal = True
            waiters, self._waiters = self._waiters, []
        for loop, flag in waiters:
            try:
                loop.call_soon_threadsafe(flag.set)
            except RuntimeError:  # loop already closed
                pass
        return event_id

    def read_from(self, last_id: int) -> Iterator[tuple[int, str, dict[str, Any]]]:
        """Events with ``id > last_id`` that were complete when the call started."""
        with self._lock:
            count = len(self._offsets)
            if last_id >= count:
                return
            start = self._offsets[max(last_id, 0)]
            end = self._size
        with self._path.open("rb") as handle:
            handle.seek(start)
            remaining = end - start
            for raw in handle:
                if remaining <= 0:
                    break
                remaining -= len(raw)
                record = json.loads(raw)
                yield int(record["id"]), str(record["event"]), record["data"]

    async def wait_for(self, last_id: int, timeout: float) -> bool:
        """True when an event with ``id > last_id`` exists (or the log is terminal)."""
        flag = asyncio.Event()
        with self._lock:
            if len(self._offsets) > last_id or self.terminal:
                return True
            self._waiters.append((asyncio.get_running_loop(), flag))
        try:
            await asyncio.wait_for(flag.wait(), timeout)
            return True
        except TimeoutError:
            return False
        finally:
            with self._lock:
                self._waiters = [w for w in self._waiters if w[1] is not flag]
