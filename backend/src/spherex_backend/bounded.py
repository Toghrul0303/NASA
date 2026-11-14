"""Hard wall-clock bounds for calls that can block inside a library (TAP, Gaia)."""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from typing import TypeVar

import requests

T = TypeVar("T")


class CallTimeout(TimeoutError):
    """A bounded call did not finish in time; its worker thread was abandoned."""


def remaining_s(deadline: float | None) -> float | None:
    """Seconds left until a ``time.monotonic()`` deadline (``None`` = unbounded)."""
    return None if deadline is None else deadline - time.monotonic()


def call_with_timeout(fn: Callable[[], T], timeout_s: float, label: str) -> T:
    """Run ``fn`` in a daemon thread and wait at most ``timeout_s``.

    On expiry the thread is abandoned (Python cannot kill it) and ``CallTimeout`` is raised.
    ``fn`` must be pure with respect to shared state: callers do any caching or writing
    *after* this returns, so a late result from an abandoned call is simply discarded.
    """
    box: dict[str, object] = {}
    done = threading.Event()

    def work() -> None:
        try:
            box["value"] = fn()
        except BaseException as exc:  # re-raised in the caller
            box["error"] = exc
        finally:
            done.set()

    threading.Thread(target=work, name=f"bounded-{label}", daemon=True).start()
    if not done.wait(max(timeout_s, 0.0)):
        raise CallTimeout(f"{label} did not answer within {timeout_s:g} s")
    if "error" in box:
        raise box["error"]  # type: ignore[misc]
    return box["value"]  # type: ignore[return-value]


class TimeoutSession(requests.Session):
    """``requests`` session that applies a default ``(connect, read)`` timeout.

    pyvo's TAP ``run_sync`` POSTs without a socket timeout (its ``timeout`` argument only bounds
    job polling), so a server that accepts and never answers blocks forever.
    """

    def __init__(self, connect_s: float, read_s: float) -> None:
        super().__init__()
        self._default_timeout = (connect_s, read_s)

    def request(self, method, url, **kwargs):  # type: ignore[no-untyped-def,override]
        kwargs.setdefault("timeout", self._default_timeout)
        if kwargs["timeout"] is None:
            kwargs["timeout"] = self._default_timeout
        return super().request(method, url, **kwargs)
