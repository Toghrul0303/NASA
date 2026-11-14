"""``spherex`` command line (§10)."""

from __future__ import annotations

import json
import logging
import sys
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Literal, NoReturn

import typer

from spherex_backend.config import ConfigError, LoadedSettings, load_settings
from spherex_backend.contract_check import (
    assert_schemas_valid,
    extract_schemas,
    write_schemas,
)
from spherex_backend.errors import ContractError

def _typer() -> typer.Typer:
    return typer.Typer(
        add_completion=False,
        no_args_is_help=True,
        pretty_exceptions_enable=False,
        rich_markup_mode=None,
    )


app = _typer()
contract_app = _typer()
channels_app = _typer()
targets_app = _typer()
probe_app = _typer()
jobs_app = _typer()
app.add_typer(contract_app, name="contract")
app.add_typer(channels_app, name="channels")
app.add_typer(targets_app, name="targets")
app.add_typer(probe_app, name="probe")
app.add_typer(jobs_app, name="jobs")

TierName = Literal["tier1", "tier1_5", "all"]
_LEVELS = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "level": record.levelname.lower(),
            "msg": record.getMessage(),
        }
        for key in ("job_id", "slug", "stage", "data"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        return json.dumps(payload, ensure_ascii=False, default=str)


def _fail(code: int, message: str) -> NoReturn:
    typer.echo(message, err=True)
    raise typer.Exit(code)


def _root(ctx: typer.Context) -> typer.Context:
    root = ctx
    while root.parent is not None:
        root = root.parent
    return root


def _cli_path(value: Path) -> Path:
    return value if value.is_absolute() else (Path.cwd() / value).resolve()


def _configure_logging(level_name: str) -> None:
    root = logging.getLogger()
    root.handlers.clear()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    root.addHandler(handler)
    root.setLevel(level_name.upper())
    logging.getLogger("astropy").setLevel(logging.ERROR)  # SIP header notices flood the log


def _settings(ctx: typer.Context) -> LoadedSettings:
    root = _root(ctx)
    if not isinstance(root.obj, dict):
        _fail(2, "missing CLI state")
    cached = root.obj.get("settings")
    if isinstance(cached, LoadedSettings):
        return cached
    config_path = root.obj.get("config_path")
    if not isinstance(config_path, Path):
        _fail(2, "missing --config")
    log_override = root.obj.get("log_level")
    if isinstance(log_override, str) and log_override.upper() not in _LEVELS:
        _fail(2, f"unknown log level {log_override!r}")
    try:
        loaded = load_settings(config_path)
    except ConfigError as exc:
        _fail(3, str(exc))
    level = log_override if isinstance(log_override, str) else loaded.settings.server.log_level
    _configure_logging(level)
    root.obj["settings"] = loaded
    return loaded


def _unavailable(ctx: typer.Context, command: str) -> None:
    _settings(ctx)
    _fail(3, f"spherex {command} is not implemented")


class _ConsoleSink:
    """Prints stage, progress and warning events; drops pixel payloads."""

    def __init__(self, slug: str) -> None:
        self._slug = slug

    def emit(self, event: str, payload: dict[str, object]) -> None:
        if event == "frame":
            return
        typer.echo(f"[{self._slug}] {event}: {json.dumps(payload, default=str)}")


@app.callback()
def main(
    ctx: typer.Context,
    config: Annotated[
        Path,
        typer.Option("--config", help="Path to config.yaml."),
    ] = Path("backend/config.yaml"),
    log_level: Annotated[
        str | None,
        typer.Option("--log-level", help="Override server.log_level."),
    ] = None,
) -> None:
    """SPHEREx Sky Explorer backend."""
    ctx.ensure_object(dict)
    ctx.obj["config_path"] = config
    ctx.obj["log_level"] = log_level


@app.command("serve")
def serve(
    ctx: typer.Context,
    host: Annotated[str | None, typer.Option("--host")] = None,
    port: Annotated[int | None, typer.Option("--port")] = None,
) -> None:
    """Start Uvicorn with one worker."""
    import uvicorn

    from spherex_backend.api import create_app

    loaded = _settings(ctx)
    server = loaded.settings.server
    uvicorn.run(
        create_app(loaded),
        host=host or server.host,
        port=port or server.port,
        workers=1,
        log_config=None,  # keep the JSON-lines logging configured by the CLI
        log_level=server.log_level.lower(),
    )


@contract_app.command("extract")
def contract_extract(
    ctx: typer.Context,
    source: Annotated[
        Path | None,
        typer.Option("--from", help="Contract markdown. Defaults to paths.contract_file."),
    ] = None,
    out: Annotated[
        Path | None,
        typer.Option("--out", help="Schema directory. Defaults to paths.schemas_dir."),
    ] = None,
) -> None:
    """Extract JSON Schema blocks from DATA_CONTRACT.md into schemas/v1/."""
    loaded = _settings(ctx)
    contract_path = _cli_path(source) if source is not None else loaded.paths.contract_file
    out_dir = _cli_path(out) if out is not None else loaded.paths.schemas_dir
    if not contract_path.is_file():
        _fail(3, f"contract file not found: {contract_path}")
    try:
        schemas = extract_schemas(contract_path.read_text(encoding="utf-8"))
        assert_schemas_valid(schemas)
        written = write_schemas(schemas, out_dir)
    except ContractError as exc:
        _fail(3, str(exc))
    except OSError as exc:
        _fail(3, f"could not write schemas: {exc}")
    for path in written:
        typer.echo(f"wrote {path}")
    typer.echo(f"extracted {len(written)} schemas into {out_dir}")


@channels_app.command("build")
def channels_build(
    ctx: typer.Context,
    source: Annotated[
        str | None, typer.Option("--source", help="HiPS cube tile or metadata.")
    ] = None,
    out: Annotated[Path | None, typer.Option("--out")] = None,
) -> None:
    """Write the 102-row channels.json table."""
    from spherex_backend import channels

    loaded = _settings(ctx)
    src = source or channels.DEFAULT_CHANNELS_SOURCE
    dest = _cli_path(out) if out is not None else loaded.paths.channels_file
    try:
        rows = channels.read_source(src)
        channels.check_rows(rows)
        channels.write_channels(rows, dest)
    except Exception as exc:
        _fail(3, f"channels build failed: {type(exc).__name__}: {exc}")
    typer.echo(f"wrote {len(rows)} channels to {dest}")


@targets_app.command("resolve")
def targets_resolve(
    ctx: typer.Context,
    slug: Annotated[list[str] | None, typer.Option("--slug")] = None,
) -> None:
    """Resolve tier1 Gaia positions into paths.resolved_targets_file."""
    from spherex_backend.resolve import resolve_targets
    from spherex_backend.targets import TargetError

    loaded = _settings(ctx)
    try:
        results = resolve_targets(loaded, slug)
    except TargetError as exc:
        _fail(3, str(exc))
    except Exception as exc:
        _fail(3, f"targets resolve failed: {type(exc).__name__}: {exc}")
    for r in results:
        rec = r.record
        typer.echo(
            f"{r.slug}: gaia {rec['gaia_source_id']} sep={r.separation_arcsec:.2f}\" "
            f"pm=({rec['pmra_mas_yr']}, {rec['pmdec_mas_yr']}) mas/yr"
        )
    typer.echo(f"wrote {loaded.paths.resolved_targets_file}")


@targets_app.command("verify")
def targets_verify(ctx: typer.Context) -> None:
    """Report n_exposures for tier 1.5 targets and WISE 0855."""
    from spherex_backend import discovery
    from spherex_backend.models import PipelineError
    from spherex_backend.targets import TargetError, configured_targets

    loaded = _settings(ctx)
    irsa = loaded.settings.irsa
    try:
        targets = configured_targets(loaded, "tier1_5") + configured_targets(
            loaded, "tier1", ["wise-0855"]
        )
    except TargetError as exc:
        _fail(3, str(exc))
    client = discovery.PyvoDiscoveryClient(irsa, loaded.paths.cache_dir)
    empty = 0
    for target in targets:
        try:
            found = discovery.discover(client, target, irsa)
            count = len(found.candidates)
        except PipelineError as exc:
            if exc.code != "no_coverage":
                _fail(3, f"{target.slug}: {exc.code}: {exc}")
            count = 0
        typer.echo(f"{target.slug}: n_exposures={count}")
        empty += count == 0
    if empty:
        _fail(3, f"{empty} target(s) have no SPHEREx exposures")


MaxFramesOpt = Annotated[
    int | None,
    typer.Option("--max-frames", min=0, help="Cap frames fetched per target (0 = unlimited)."),
]
CacheOnlyOpt = Annotated[
    bool, typer.Option("--cache-only", help="Use only cached cutouts; never touch the network.")
]
FetchBudgetOpt = Annotated[
    float | None,
    typer.Option("--fetch-budget", min=0.0, help="Wall-clock seconds allowed for fetches."),
]
ResetBreakerOpt = Annotated[
    bool, typer.Option("--reset-breaker", help="Forget persisted dead-host state first.")
]


def _with_run_options(
    loaded: LoadedSettings,
    tier: str,
    max_frames: int | None,
    cache_only: bool,
    fetch_budget: float | None,
) -> LoadedSettings:
    """Apply CLI overrides on top of the tier's effective settings (flags win)."""
    effective = loaded.effective(tier)
    settings = effective.settings
    sampling = settings.sampling
    if max_frames is not None:
        sampling = sampling.model_copy(update={"max_frames_per_target": max_frames})
    if cache_only:
        sampling = sampling.model_copy(update={"cache_only": True})
    update: dict[str, object] = {"sampling": sampling}
    if fetch_budget is not None:
        update["fetch_budget_s"] = fetch_budget if fetch_budget > 0 else None
    return replace(effective, settings=settings.model_copy(update=update))


@app.command("build")
def build(
    ctx: typer.Context,
    slug: Annotated[list[str] | None, typer.Option("--slug")] = None,
    tier: Annotated[TierName, typer.Option("--tier")] = "all",
    force: Annotated[bool, typer.Option("--force")] = False,
    max_frames: MaxFramesOpt = None,
    cache_only: CacheOnlyOpt = False,
    fetch_budget: FetchBudgetOpt = None,
    reset_breaker: ResetBreakerOpt = False,
) -> None:
    """Run the pipeline for configured targets."""
    from spherex_backend import fetch
    from spherex_backend.models import PipelineError
    from spherex_backend.pipeline import run_pipeline
    from spherex_backend.targets import TargetError, configured_targets

    loaded = _settings(ctx)
    try:
        targets = configured_targets(loaded, tier, slug)
    except TargetError as exc:
        _fail(3, str(exc))
    if reset_breaker:
        fetch.BREAKER.configure(loaded.settings.irsa.breaker, fetch.breaker_path(loaded))
        fetch.BREAKER.reset()
        typer.echo("breaker state cleared")
    failures = 0
    for target in targets:
        if (loaded.paths.data_dir / target.slug / "meta.json").is_file() and not force:
            typer.echo(f"{target.slug}: exists, skipped (use --force)")
            continue
        sink = _ConsoleSink(target.slug)
        deadline = None  # offline batch builds are not bound by the job timeout
        run_loaded = _with_run_options(loaded, target.tier, max_frames, cache_only, fetch_budget)
        try:
            out = run_pipeline(target, sink, deadline, loaded=run_loaded)
        except PipelineError as exc:
            failures += 1
            typer.echo(f"{target.slug}: FAILED {exc.code}: {exc}", err=True)
            continue
        typer.echo(
            f"{out.slug}: {out.result_status} frames={out.n_frames} epochs={out.n_epochs} "
            f"failed={out.n_failed_fetches} skipped_breaker={out.n_skipped_breaker} "
            f"skipped_budget={out.n_skipped_budget} seconds={out.elapsed_s:.1f} "
            f"data_version={out.data_version}"
        )
    if failures:
        _fail(3, f"{failures} target(s) failed")


@app.command("build-coord")
def build_coord(
    ctx: typer.Context,
    ra: Annotated[float, typer.Option("--ra")],
    dec: Annotated[float, typer.Option("--dec")],
    size: Annotated[float | None, typer.Option("--size")] = None,
    name: Annotated[str | None, typer.Option("--name")] = None,
    pmra: Annotated[float | None, typer.Option("--pmra")] = None,
    pmdec: Annotated[float | None, typer.Option("--pmdec")] = None,
    epoch: Annotated[float | None, typer.Option("--epoch")] = None,
    force: Annotated[bool, typer.Option("--force")] = False,
    max_frames: MaxFramesOpt = None,
    cache_only: CacheOnlyOpt = False,
    fetch_budget: FetchBudgetOpt = None,
    reset_breaker: ResetBreakerOpt = False,
) -> None:
    """Run the Tier 2 pipeline for one coordinate (not implemented yet)."""
    _ = (ra, dec, size, name, pmra, pmdec, epoch, force)
    _ = (max_frames, cache_only, fetch_budget, reset_breaker)
    _unavailable(ctx, "build-coord")


@app.command("update")
def update(
    ctx: typer.Context,
    tier: Annotated[TierName, typer.Option("--tier")] = "all",
) -> None:
    """Rediscover configured targets and rebuild when data_version changes.

    NOTE: data_version is hashed over ALL discovered URIs, so `update` prints "unchanged"
    even when previously dead weeks have recovered. Use `build --force` to retry them.
    """
    _ = tier
    _unavailable(ctx, "update")


@app.command("warm")
def warm(
    ctx: typer.Context,
    file: Annotated[Path, typer.Option("--file")],
) -> None:
    """Run build-coord for each ra dec [size] line in FILE."""
    _ = file
    _unavailable(ctx, "warm")


@app.command("validate")
def validate(
    ctx: typer.Context,
    path: Annotated[Path | None, typer.Argument()] = None,
    slug: Annotated[str | None, typer.Option("--slug")] = None,
    all_targets: Annotated[bool, typer.Option("--all")] = False,
) -> None:
    """Validate a published directory against the contract (exit 3 on any violation)."""
    from spherex_backend.contract_check import load_registry, validate_directory

    loaded = _settings(ctx)
    if (path is not None) + (slug is not None) + bool(all_targets) != 1:
        _fail(2, "give exactly one of PATH, --slug S or --all")
    try:
        registry = load_registry(loaded.paths.schemas_dir)
    except (ContractError, OSError, ValueError) as exc:
        _fail(3, f"cannot load schemas from {loaded.paths.schemas_dir}: {exc}")
    targets: list[tuple[Path, str | None]]
    if path is not None:
        targets = [(_cli_path(path), None)]
    elif slug is not None:
        targets = [(loaded.paths.data_dir / slug, slug)]
    else:
        root = loaded.paths.data_dir
        names = sorted(
            p.name for p in root.iterdir() if p.is_dir() and not p.name.startswith(".")
        ) if root.is_dir() else []
        targets = [(root / n, n) for n in names]
        if not targets:
            _fail(3, f"no data directories under {root}")
    bad = 0
    for directory, expected in targets:
        if not directory.is_dir():
            typer.echo(f"{directory}: directory does not exist", err=True)
            bad += 1
            continue
        violations = validate_directory(directory, registry, expected_slug=expected)
        if violations:
            bad += 1
            typer.echo(f"{directory.name}: {len(violations)} violation(s)", err=True)
            for violation in violations:
                typer.echo(f"  {violation}", err=True)
        else:
            typer.echo(f"{directory.name}: OK")
    if bad:
        _fail(3, f"{bad} director(y/ies) failed validation")


@probe_app.command("irsa")
def probe_irsa(
    ctx: typer.Context,
    ra: Annotated[float, typer.Option("--ra")],
    dec: Annotated[float, typer.Option("--dec")],
) -> None:
    """Run one IRSA TAP discovery and one cutout fetch."""
    _ = (ra, dec)
    _unavailable(ctx, "probe irsa")


@probe_app.command("gaia")
def probe_gaia(
    ctx: typer.Context,
    ra: Annotated[float, typer.Option("--ra")],
    dec: Annotated[float, typer.Option("--dec")],
) -> None:
    """Run one Gaia cone query and print the selected columns."""
    _ = (ra, dec)
    _unavailable(ctx, "probe gaia")


@jobs_app.command("prune")
def jobs_prune(ctx: typer.Context) -> None:
    """Prune expired jobs once."""
    _unavailable(ctx, "jobs prune")
