"""Load ``config.yaml``, deep-merge ``config.local.yaml``, apply ``SPHEREX__`` overrides."""

from __future__ import annotations

import copy
import json
import math
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from spherex_backend.contract_check import extract_schemas, iter_fenced_json
from spherex_backend.errors import ConfigError, ContractError

_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
_ENV_PREFIX = "SPHEREX__"
_TIER2_OVERRIDE_KEYS = frozenset({"jobs", "irsa", "gaia", "sampling", "fetch_budget_s"})


def _is_int_item(key: object, item: object) -> bool:
    return isinstance(key, str) and isinstance(item, int) and not isinstance(item, bool)


def _same(actual: object, expected: object) -> bool:
    if isinstance(actual, bool) or isinstance(expected, bool):
        return actual == expected
    if isinstance(actual, (int, float)) and isinstance(expected, (int, float)):
        return math.isclose(float(actual), float(expected), rel_tol=1e-9, abs_tol=0.0)
    if isinstance(actual, list) and isinstance(expected, list):
        return len(actual) == len(expected) and all(
            _same(left, right) for left, right in zip(actual, expected, strict=True)
        )
    if isinstance(actual, dict) and isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(
            _same(actual[key], expected[key]) for key in actual
        )
    return actual == expected


def _section(text: str, start: str, end: str) -> str:
    if start not in text:
        raise ContractError(f"contract is missing {start!r}")
    body = text.split(start, 1)[1]
    return body.split(end, 1)[0]


def _bad_flag_bits(text: str) -> dict[str, int]:
    section = _section(text, "### 3.4 Flag bits", "### 3.5 ")
    bits = {
        name: int(bit)
        for name, bit in re.findall(r"`([A-Z][A-Z0-9_]*)`\s*\|\s*(\d+)", section)
    }
    if len(bits) != 15:
        raise ContractError(f"expected 15 bad flag bits in §3.4, found {sorted(bits)}")
    source = re.search(r"`SOURCE` \(bit (\d+)\)", section)
    mask = re.search(r"BAD_MASK = (\d+)", section)
    if source is None or mask is None:
        raise ContractError("contract §3.4 is missing SOURCE or BAD_MASK")
    if int(source.group(1)) != 21:
        raise ContractError("contract SOURCE bit is not 21")
    prose_mask = int(mask.group(1))
    summed = sum(1 << bit for bit in bits.values())
    if prose_mask != summed:
        raise ContractError(f"contract BAD_MASK {prose_mask} != sum of flag bits {summed}")
    flat_maps: list[dict[str, int]] = []
    for value in iter_fenced_json(text):
        if not isinstance(value, dict) or not value:
            continue
        if "$schema" in value or "$id" in value:
            continue
        if all(_is_int_item(key, item) for key, item in value.items()):
            flat_maps.append({str(key): int(item) for key, item in value.items()})
    if bits not in flat_maps:
        raise ContractError("contract flag-bit table does not match the fixed JSON block")
    return bits


def _at(document: dict[str, Any], *keys: str) -> Any:
    node: Any = document
    walked: list[str] = []
    for key in keys:
        walked.append(key)
        if not isinstance(node, dict) or key not in node:
            raise ContractError("contract schema missing " + ".".join(walked))
        node = node[key]
    return node


def _expect(problems: list[str], label: str, actual: object, expected: object) -> None:
    if not _same(actual, expected):
        problems.append(f"{label}: config has {actual!r}, contract has {expected!r}")


def _assert_contract(settings: Settings, text: str) -> None:
    schemas = extract_schemas(text)
    for name in (
        "common.schema.json",
        "meta.schema.json",
        "sed.schema.json",
        "gaia.schema.json",
    ):
        if name not in schemas:
            raise ContractError(f"contract is missing {name}")
    common = schemas["common.schema.json"]
    meta = schemas["meta.schema.json"]
    sed = schemas["sed.schema.json"]
    gaia = schemas["gaia.schema.json"]
    processing = settings.processing
    problems: list[str] = []

    pixel_scale = _at(meta, "properties", "grid", "properties", "pixel_scale_arcsec", "const")
    prose_scale = re.search(
        r"Pixel scale\s*\|\s*`([0-9]+(?:\.[0-9]+)?)`\s*arcsec/pixel",
        text,
    )
    if prose_scale is None:
        raise ContractError("contract is missing the pixel-scale row")
    if not _same(pixel_scale, float(prose_scale.group(1))):
        raise ContractError("contract pixel scale disagrees with meta.schema.json")
    _expect(problems, "grid.pixel_scale_arcsec", settings.grid.pixel_scale_arcsec, pixel_scale)
    _expect(
        problems,
        "grid.size_choices_deg",
        settings.grid.size_choices_deg,
        _at(common, "$defs", "size_deg", "enum"),
    )

    flag_bits = _bad_flag_bits(text)
    _expect(problems, "processing.bad_flag_bits", processing.bad_flag_bits, flag_bits)
    _expect(
        problems,
        "processing.bad_mask",
        processing.bad_mask,
        _at(meta, "properties", "processing", "properties", "bad_mask", "const"),
    )
    source_bit = _at(
        meta,
        "properties",
        "processing",
        "properties",
        "benign_flag_bits",
        "properties",
        "SOURCE",
        "const",
    )
    _expect(
        problems,
        "processing.benign_flag_bits",
        processing.benign_flag_bits,
        {"SOURCE": source_bit},
    )
    radii = _at(meta, "properties", "processing", "properties", "photometry_radii_px", "const")
    annulus = _at(meta, "properties", "processing", "properties", "annulus_px", "const")
    _expect(problems, "processing.photometry_radii_px", processing.photometry_radii_px, radii)
    _expect(problems, "processing.annulus_px", processing.annulus_px, annulus)
    if not _same(radii, _at(sed, "properties", "aperture_radii_px", "const")):
        raise ContractError("sed aperture radii disagree with meta.processing")
    if not _same(annulus, _at(sed, "properties", "annulus_px", "const")):
        raise ContractError("sed annulus disagrees with meta.processing")
    _expect(
        problems,
        "processing.pm_fit_min_epochs",
        processing.pm_fit_min_epochs,
        _at(meta, "properties", "processing", "properties", "pm_fit_min_epochs", "const"),
    )
    _expect(
        problems,
        "processing.pm_fit_min_baseline_days",
        processing.pm_fit_min_baseline_days,
        _at(meta, "properties", "processing", "properties", "pm_fit_min_baseline_days", "const"),
    )
    clipped = re.search(r"magnitude above (\d+) are clipped", text)
    if clipped is None:
        raise ContractError("contract is missing the float16 clip limit")
    _expect(problems, "processing.float16_max", processing.float16_max, int(clipped.group(1)))
    _expect(
        problems,
        "photometry.nominal_pixel_sr",
        settings.photometry.nominal_pixel_sr,
        _at(sed, "properties", "nominal_pixel_sr", "const"),
    )
    _expect(
        problems,
        "gaia.endpoint",
        settings.gaia.endpoint,
        _at(gaia, "properties", "query", "properties", "endpoint", "const"),
    )
    _expect(
        problems,
        "gaia.table",
        settings.gaia.table,
        _at(gaia, "properties", "query", "properties", "table", "const"),
    )
    _expect(
        problems,
        "gaia.match_radius_arcsec",
        settings.gaia.match_radius_arcsec,
        _at(gaia, "properties", "match_radius_arcsec", "const"),
    )
    _expect(
        problems,
        "previews.lower_percentile",
        settings.previews.lower_percentile,
        _at(
            meta,
            "properties",
            "previews",
            "properties",
            "stretch",
            "properties",
            "lower_percentile",
            "const",
        ),
    )
    _expect(
        problems,
        "previews.upper_percentile",
        settings.previews.upper_percentile,
        _at(
            meta,
            "properties",
            "previews",
            "properties",
            "stretch",
            "properties",
            "upper_percentile",
            "const",
        ),
    )
    if problems:
        raise ConfigError("config disagrees with DATA_CONTRACT.md:\n" + "\n".join(problems))


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PathsConfig(_Strict):
    data_dir: str
    cache_dir: str
    channels_file: str
    schemas_dir: str
    contract_file: str
    resolved_targets_file: str


class ServerConfig(_Strict):
    host: str
    port: int
    workers: int
    cors_allow_origins: list[str]
    log_level: str

    @field_validator("workers")
    @classmethod
    def one_worker(cls, value: int) -> int:
        if value != 1:
            raise ValueError("server.workers must be 1")
        return value

    @field_validator("log_level")
    @classmethod
    def known_level(cls, value: str) -> str:
        if value.upper() not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise ValueError(f"unknown log level {value!r}")
        return value


class JobsConfig(_Strict):
    max_concurrent_jobs: int
    queue_capacity: int
    retry_after_s: int
    cache_ttl_hours: int
    event_retention_hours: int
    tier2_data_retention_days: int
    job_timeout_s: int
    sse_keepalive_s: int
    sse_retry_ms: int
    progress_max_hz: int

    @model_validator(mode="after")
    def retention_covers_cache(self) -> JobsConfig:
        if self.event_retention_hours < self.cache_ttl_hours:
            raise ValueError("jobs.event_retention_hours must be >= jobs.cache_ttl_hours")
        return self


class HttpConfig(_Strict):
    connect_timeout_s: float = Field(gt=0)
    read_timeout_s: float = Field(gt=0)
    total_timeout_s: float = Field(gt=0)
    retry_after_cap_s: float = Field(ge=0)


class BreakerConfig(_Strict):
    enabled: bool
    group_regex: str
    consecutive_failures: int = Field(ge=1)
    window: int = Field(ge=1)
    window_failures: int = Field(ge=1)
    cooldown_s: float = Field(ge=0)  # 0 = no half-open probing during the run
    persist_path: str
    persist_ttl_s: float = Field(ge=0)

    @field_validator("group_regex")
    @classmethod
    def compiles(cls, value: str) -> str:
        try:
            re.compile(value)
        except re.error as exc:
            raise ValueError(f"invalid regular expression: {exc}") from exc
        return value


class SamplingConfig(_Strict):
    max_frames_per_target: int = Field(ge=0)  # 0 = unlimited
    min_per_stratum: int = Field(ge=1)
    prefer_cached: bool
    cache_only: bool


class IrsaConfig(_Strict):
    tap_url: str
    tap_timeout_s: int
    tap_retries: int
    tap_backoff_s: float = Field(ge=0)
    tap_cache_ttl_s: int
    releases: list[Literal["dr1", "qr3"]]
    release_path_pattern: str
    uri_prefix: str
    cutout_query_template: str
    cutout_margin_deg: float
    max_concurrent_fetches: int = Field(ge=1)
    fetch_retries: int = Field(ge=1)
    fetch_backoff_s: float = Field(ge=0)
    fetch_jitter_s: float = Field(ge=0)
    http: HttpConfig
    breaker: BreakerConfig
    remote_timeout_s: int
    discovery_epoch_mjd: float
    rediscovery_threshold_arcsec: float


class GridConfig(_Strict):
    pixel_scale_arcsec: float
    size_choices_deg: list[float]
    default_size_deg: float


class ProcessingConfig(_Strict):
    epoch_gap_days: float
    contamination_severe_fraction: float
    reprojection: Literal["interp", "exact"]
    bad_flag_bits: dict[str, int]
    benign_flag_bits: dict[str, int]
    bad_mask: int
    aperture_radius_px: int
    photometry_radii_px: list[int]
    annulus_px: list[int]
    background_clip_sigma: float
    background_clip_iters: int
    background_source_mask_radius_px: int
    centroid_window_radius_px: int
    centroid_mc_samples: int
    alignment_max_sources: int
    alignment_min_sources: int
    pm_fit_min_epochs: int
    pm_fit_min_baseline_days: int
    float16_max: float
    pm_centroid_sigma_floor_px: float

    @model_validator(mode="after")
    def mask_matches_bits(self) -> ProcessingConfig:
        if "SOURCE" in self.bad_flag_bits:
            raise ValueError("SOURCE is benign and must not be part of bad_flag_bits")
        total = sum(1 << bit for bit in self.bad_flag_bits.values())
        if self.bad_mask != total:
            raise ValueError(f"processing.bad_mask {self.bad_mask} != sum of bad flag bits {total}")
        return self


class SapmConfig(_Strict):
    uri_template: str | None


class PhotometryConfig(_Strict):
    solid_angle: Literal["auto", "nominal_pixel"]
    nominal_pixel_sr: float
    sapm: SapmConfig


class GaiaConfig(_Strict):
    endpoint: str
    table: str
    static_radius_arcsec: float
    match_radius_arcsec: float
    reference_epoch_year: float
    timeout_s: int
    retries: int
    cache_ttl_days: int


class PreviewsConfig(_Strict):
    asinh_a: float
    lower_percentile: float
    upper_percentile: float


class ExportConfig(_Strict):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    validate_files: bool = Field(alias="validate")

    @property
    def validate(self) -> bool:
        return self.validate_files


class ResolveConfig(_Strict):
    max_separation_arcsec: float


class PmConfig(_Strict):
    pmra_mas_yr: float
    pmdec_mas_yr: float
    parallax_mas: float
    source: Literal["literature"]
    reference: str


class Tier1Position(_Strict):
    resolve: Literal["gaia"] | None = None
    gaia_search_radius_arcsec: float | None = None
    ra_deg: float | None = None
    dec_deg: float | None = None
    coord_epoch_year: float | None = None

    @model_validator(mode="before")
    @classmethod
    def one_shape(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            raise ValueError("position must be a mapping")
        keys = set(data)
        if data.get("resolve") == "gaia":
            if keys != {"resolve", "gaia_search_radius_arcsec"}:
                raise ValueError(
                    "gaia position requires resolve and gaia_search_radius_arcsec only"
                )
            return data
        if keys != {"ra_deg", "dec_deg", "coord_epoch_year"}:
            raise ValueError(
                "position requires resolve: gaia or ra_deg, dec_deg, and coord_epoch_year"
            )
        return data

    @model_validator(mode="after")
    def values_in_range(self) -> Tier1Position:
        if self.resolve == "gaia":
            if self.gaia_search_radius_arcsec is None or self.gaia_search_radius_arcsec <= 0:
                raise ValueError("gaia_search_radius_arcsec must be positive")
            return self
        if self.ra_deg is None or not 0 <= self.ra_deg < 360:
            raise ValueError("ra_deg must be in [0, 360)")
        if self.dec_deg is None or not -90 <= self.dec_deg <= 90:
            raise ValueError("dec_deg must be in [-90, 90]")
        if self.coord_epoch_year is not None and not 1900 <= self.coord_epoch_year <= 2100:
            raise ValueError("coord_epoch_year must be in [1900, 2100] or null")
        return self


class Tier1Target(_Strict):
    slug: str
    title: str
    name: str
    resolver_name: str | None = None
    size_deg: float
    position: Tier1Position
    pm: PmConfig | None = None

    @model_validator(mode="after")
    def slug_and_resolver(self) -> Tier1Target:
        if _SLUG.fullmatch(self.slug) is None:
            raise ValueError(f"invalid slug {self.slug!r}")
        if self.position.resolve == "gaia" and not self.resolver_name:
            raise ValueError("resolve: gaia requires resolver_name")
        return self


class Tier15Target(_Strict):
    slug: str
    title: str
    ra_deg: float
    dec_deg: float
    size_deg: float

    @model_validator(mode="after")
    def ranges(self) -> Tier15Target:
        if _SLUG.fullmatch(self.slug) is None:
            raise ValueError(f"invalid slug {self.slug!r}")
        if not 0 <= self.ra_deg < 360:
            raise ValueError("ra_deg must be in [0, 360)")
        if not -90 <= self.dec_deg <= 90:
            raise ValueError("dec_deg must be in [-90, 90]")
        return self


def _size_allowed(size_deg: float, choices: list[float]) -> bool:
    return any(math.isclose(size_deg, choice, rel_tol=0.0, abs_tol=1e-12) for choice in choices)


class Settings(_Strict):
    version: Literal[1]
    paths: PathsConfig
    server: ServerConfig
    jobs: JobsConfig
    irsa: IrsaConfig
    grid: GridConfig
    processing: ProcessingConfig
    photometry: PhotometryConfig
    gaia: GaiaConfig
    previews: PreviewsConfig
    export: ExportConfig
    resolve: ResolveConfig
    sampling: SamplingConfig
    fetch_budget_s: float | None = Field(default=None, gt=0)  # null = unlimited
    tier1_targets: list[Tier1Target] = Field(min_length=1)
    tier1_5_targets: list[Tier15Target] = Field(min_length=1)
    tier2_overrides: dict[str, Any] = Field(default_factory=dict)

    def effective(self, tier: str) -> Settings:
        """Settings for ``tier``: Tier 2 gets ``tier2_overrides`` deep-merged on top."""
        if tier != "tier2" or not self.tier2_overrides:
            return self
        updates: dict[str, Any] = {}
        for key, override in self.tier2_overrides.items():
            if key == "fetch_budget_s":
                if override is not None and (
                    isinstance(override, bool)
                    or not isinstance(override, (int, float))
                    or override <= 0
                ):
                    raise ConfigError("tier2_overrides.fetch_budget_s must be null or > 0")
                updates[key] = override
                continue
            section = getattr(self, key)
            if not isinstance(override, dict):
                raise ConfigError(f"tier2_overrides.{key} must be a mapping")
            merged = _deep_merge(section.model_dump(by_alias=True), override)
            try:
                updates[key] = type(section).model_validate(merged)
            except ValidationError as exc:
                raise ConfigError(_format_validation(exc, f"tier2_overrides.{key}.")) from exc
        return self.model_copy(update=updates)

    @field_validator("tier2_overrides")
    @classmethod
    def overrides_scope(cls, value: dict[str, Any]) -> dict[str, Any]:
        unknown = sorted(set(value) - _TIER2_OVERRIDE_KEYS)
        if unknown:
            raise ValueError(
                f"tier2_overrides may only set {sorted(_TIER2_OVERRIDE_KEYS)}, got {unknown}"
            )
        return value

    @model_validator(mode="after")
    def target_sizes(self) -> Settings:
        choices = self.grid.size_choices_deg
        if not _size_allowed(self.grid.default_size_deg, choices):
            raise ValueError("grid.default_size_deg must be one of grid.size_choices_deg")
        slugs: list[str] = []
        for target in [*self.tier1_targets, *self.tier1_5_targets]:
            if not _size_allowed(target.size_deg, choices):
                raise ValueError(f"{target.slug}: size_deg must be one of grid.size_choices_deg")
            slugs.append(target.slug)
        if len(slugs) != len(set(slugs)):
            raise ValueError("target slugs must be unique")
        return self


@dataclass(frozen=True)
class ResolvedPaths:
    data_dir: Path
    cache_dir: Path
    channels_file: Path
    schemas_dir: Path
    contract_file: Path
    resolved_targets_file: Path


@dataclass(frozen=True)
class LoadedSettings:
    config_path: Path
    settings: Settings
    paths: ResolvedPaths
    effective_tier: str | None = None

    def effective(self, tier: str) -> LoadedSettings:
        """Settings for ``tier`` (idempotent; Tier 2 applies ``tier2_overrides`` once)."""
        if self.effective_tier == tier:
            return self
        return replace(self, settings=self.settings.effective(tier), effective_tier=tier)


def _load_yaml(path: Path) -> dict[str, Any]:
    try:
        loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ConfigError(f"could not parse {path}: {exc}") from exc
    except OSError as exc:
        raise ConfigError(f"could not read {path}: {exc}") from exc
    if loaded is None:
        return {}
    if not isinstance(loaded, dict):
        raise ConfigError(f"{path} must be a mapping")
    return loaded


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in override.items():
        current = merged.get(key)
        if isinstance(current, dict) and isinstance(value, dict):
            merged[key] = _deep_merge(current, value)
        else:
            merged[key] = value
    return merged


def _coerce(raw: str, current: object) -> object:
    if isinstance(current, bool):
        lowered = raw.lower()
        if lowered in {"1", "true", "yes"}:
            return True
        if lowered in {"0", "false", "no"}:
            return False
        raise ConfigError(f"cannot read boolean from {raw!r}")
    if isinstance(current, int):
        try:
            return int(raw)
        except ValueError as exc:
            raise ConfigError(f"cannot read integer from {raw!r}") from exc
    if isinstance(current, float):
        try:
            return float(raw)
        except ValueError as exc:
            raise ConfigError(f"cannot read number from {raw!r}") from exc
    if isinstance(current, str):
        return raw
    if isinstance(current, list):
        return _decode_json_container(raw, list)
    if isinstance(current, dict):
        return _decode_json_container(raw, dict)
    if current is None:
        if raw.lower() in {"null", "none"}:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw
    raise ConfigError(f"cannot override a {type(current).__name__} from the environment")


def _decode_json_container(raw: str, kind: type[list[Any]] | type[dict[str, Any]]) -> object:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ConfigError(f"environment override must be JSON: {exc}") from exc
    if not isinstance(parsed, kind):
        raise ConfigError(f"environment override must be a {kind.__name__}")
    return parsed


def _apply_env(data: dict[str, Any], environ: Mapping[str, str]) -> dict[str, Any]:
    merged: dict[str, Any] = copy.deepcopy(data)
    for key, raw in environ.items():
        if not key.startswith(_ENV_PREFIX):
            continue
        parts = [part.lower() for part in key.removeprefix(_ENV_PREFIX).split("__") if part]
        if not parts:
            raise ConfigError(f"empty config path in {key}")
        node: Any = merged
        for part in parts[:-1]:
            if not isinstance(node, dict) or part not in node:
                raise ConfigError(f"unknown config path {key}")
            node = node[part]
        leaf = parts[-1]
        if not isinstance(node, dict) or leaf not in node:
            raise ConfigError(f"unknown config path {key}")
        node[leaf] = _coerce(raw, node[leaf])
    return merged


def _resolve(config_dir: Path, value: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        path = config_dir / path
    return path.resolve()


def _format_validation(exc: ValidationError, prefix: str = "") -> str:
    lines = [
        f"{prefix}{'.'.join(str(part) for part in err['loc'])}: {err['msg']}"
        for err in exc.errors()
    ]
    return "invalid config:\n" + "\n".join(lines)


def load_settings(
    config_path: Path,
    *,
    environ: Mapping[str, str] | None = None,
) -> LoadedSettings:
    """Load, merge, validate, and assert one config file."""
    path = config_path if config_path.is_absolute() else (Path.cwd() / config_path).resolve()
    if not path.is_file():
        raise ConfigError(f"config file not found: {path}")
    data = _load_yaml(path)
    local_path = path.with_name("config.local.yaml")
    if local_path.is_file():
        data = _deep_merge(data, _load_yaml(local_path))
    data = _apply_env(data, os.environ if environ is None else environ)
    try:
        settings = Settings.model_validate(data)
    except ValidationError as exc:
        raise ConfigError(_format_validation(exc)) from exc
    paths = ResolvedPaths(
        data_dir=_resolve(path.parent, settings.paths.data_dir),
        cache_dir=_resolve(path.parent, settings.paths.cache_dir),
        channels_file=_resolve(path.parent, settings.paths.channels_file),
        schemas_dir=_resolve(path.parent, settings.paths.schemas_dir),
        contract_file=_resolve(path.parent, settings.paths.contract_file),
        resolved_targets_file=_resolve(path.parent, settings.paths.resolved_targets_file),
    )
    if not paths.contract_file.is_file():
        raise ConfigError(f"contract file not found: {paths.contract_file}")
    try:
        _assert_contract(settings, paths.contract_file.read_text(encoding="utf-8"))
    except ContractError as exc:
        raise ConfigError(str(exc)) from exc
    settings.effective("tier2")  # fail at startup on a bad tier2_overrides block
    return LoadedSettings(config_path=path, settings=settings, paths=paths)
