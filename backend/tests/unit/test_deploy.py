"""Deployment gates: CORS allow-list and ENABLE_LIVE_JOBS. No network."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

from fastapi.testclient import TestClient

from spherex_backend.api import cors_policy, create_app, live_jobs_enabled, validate_request
from spherex_backend.config import load_settings
from spherex_backend.jobs import utc_now

ROOT = Path(__file__).resolve().parents[3]
CONFIG = ROOT / "backend" / "config.yaml"

CACHED_BODY = {"ra_deg": 10.0, "dec_deg": 20.0, "size_deg": 0.1, "name": "cached"}
UNCACHED_BODY = {"ra_deg": 11.0, "dec_deg": 20.0, "size_deg": 0.1, "name": "new"}
ALLOWED = "https://app.example"


def _loaded(tmp_path: Path):
    loaded = load_settings(CONFIG, environ={})
    paths = replace(
        loaded.paths,
        data_dir=tmp_path / "data",
        cache_dir=tmp_path / "cache",
    )
    return replace(loaded, paths=paths)


def _write_cached(data_dir: Path) -> str:
    request = validate_request(json.dumps(CACHED_BODY).encode())
    slug = request.slug()
    meta = {
        "status": "complete",
        "created_utc": utc_now(),
        "data_version": "sha256:" + "ab" * 32,
        "files": {},
        "observations": {"n_frames": 1, "n_epochs": 1, "n_failed_fetches": 0},
    }
    path = data_dir / slug / "meta.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(meta), encoding="utf-8")
    return slug


def test_data_dir_env_overrides_config(tmp_path: Path) -> None:
    target = tmp_path / "shipped"
    loaded = load_settings(CONFIG, environ={"DATA_DIR": str(target)})
    assert loaded.paths.data_dir == target.resolve()


def test_live_jobs_default_and_switch(monkeypatch) -> None:
    monkeypatch.delenv("ENABLE_LIVE_JOBS", raising=False)
    assert live_jobs_enabled() is True
    monkeypatch.setenv("ENABLE_LIVE_JOBS", "false")
    assert live_jobs_enabled() is False
    monkeypatch.setenv("ENABLE_LIVE_JOBS", "0")
    assert live_jobs_enabled() is False


def test_cors_env_falls_back_to_merged_config(monkeypatch) -> None:
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    monkeypatch.delenv("CORS_ORIGIN_REGEX", raising=False)
    loaded = load_settings(CONFIG, environ={})
    origins, regex = cors_policy(loaded.settings.server)
    assert origins == loaded.settings.server.cors_allow_origins
    assert regex is None
    monkeypatch.setenv("CORS_ORIGINS", " https://a.example , https://b.example ")
    monkeypatch.setenv("CORS_ORIGIN_REGEX", r"https://.*\.vercel\.app")
    origins, regex = cors_policy(loaded.settings.server)
    assert origins == ["https://a.example", "https://b.example"]
    assert regex == r"https://.*\.vercel\.app"


def test_cors_allow_deny_preflight_and_data(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", ALLOWED)
    monkeypatch.setenv("CORS_ORIGIN_REGEX", r"https://preview-.*\.vercel\.app")
    monkeypatch.setenv("ENABLE_LIVE_JOBS", "false")
    loaded = _loaded(tmp_path)
    slug = _write_cached(loaded.paths.data_dir)
    app = create_app(loaded)

    with TestClient(app) as client:
        allowed = client.get("/api/health", headers={"Origin": ALLOWED})
        assert allowed.status_code == 200
        assert allowed.headers["access-control-allow-origin"] == ALLOWED

        denied = client.get("/api/health", headers={"Origin": "https://evil.example"})
        assert denied.status_code == 200
        assert "access-control-allow-origin" not in denied.headers

        preview = client.get(
            "/api/health",
            headers={"Origin": "https://preview-abc.vercel.app"},
        )
        assert preview.headers["access-control-allow-origin"] == "https://preview-abc.vercel.app"

        preflight = client.options(
            "/api/jobs",
            headers={
                "Origin": ALLOWED,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,last-event-id",
            },
        )
        assert preflight.status_code == 200
        assert preflight.headers["access-control-allow-origin"] == ALLOWED
        allow_methods = preflight.headers["access-control-allow-methods"]
        assert "GET" in allow_methods and "POST" in allow_methods and "OPTIONS" in allow_methods
        assert "last-event-id" in preflight.headers["access-control-allow-headers"].lower()

        data = client.get(f"/data/{slug}/meta.json", headers={"Origin": ALLOWED})
        assert data.status_code == 200
        assert data.headers["access-control-allow-origin"] == ALLOWED
        exposed = data.headers["access-control-expose-headers"].lower()
        assert "etag" in exposed


def test_live_jobs_disabled_serves_cache_and_blocks_uncached(tmp_path: Path, monkeypatch) -> None:
    calls: list[str] = []

    def _explode(*_args: object, **_kwargs: object) -> None:
        calls.append("run_pipeline")
        raise AssertionError("IRSA pipeline must not run")

    monkeypatch.setattr("spherex_backend.jobs.run_pipeline", _explode)
    monkeypatch.setenv("ENABLE_LIVE_JOBS", "false")
    monkeypatch.setenv("CORS_ORIGINS", ALLOWED)
    loaded = _loaded(tmp_path)
    slug = _write_cached(loaded.paths.data_dir)
    app = create_app(loaded)

    with TestClient(app) as client:
        cached = client.post("/api/jobs", json=CACHED_BODY)
        assert cached.status_code == 200
        body = cached.json()
        assert body["cached"] is True
        assert body["slug"] == slug
        assert body["status"] == "complete"

        missed = client.post("/api/jobs", json=UNCACHED_BODY)
        assert missed.status_code == 503
        assert missed.json()["error"]["code"] == "live_jobs_disabled"

        refresh = client.post("/api/jobs", json={**CACHED_BODY, "force_refresh": True})
        assert refresh.status_code == 503
        assert refresh.json()["error"]["code"] == "live_jobs_disabled"

    assert calls == []
