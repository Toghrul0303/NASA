"""Contract tooling: schema extraction and directory conformance (BACKEND_SPEC 6.8, 10).

`extract_schemas` / `write_schemas` back ``spherex contract extract``.
`load_registry` / `validate_directory` check a produced ``/data/{slug}/`` directory.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from jsonschema.exceptions import SchemaError
from jsonschema.validators import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from spherex_backend import binfmt
from spherex_backend.errors import ContractError
from spherex_backend.grid import Grid

SCHEMA_BASE = "https://spherex-sky-explorer/schema/v1/"

_JSON_FENCE = re.compile(r"```json[ \t]*\r?\n(.*?)```", re.DOTALL)


def iter_fenced_json(markdown: str) -> list[Any]:
    """Return every fenced ```json value. A broken schema block is an error."""
    values: list[Any] = []
    for match in _JSON_FENCE.finditer(markdown):
        body = match.group(1)
        try:
            values.append(json.loads(body))
        except json.JSONDecodeError as exc:
            if "$schema" in body or "$id" in body:
                raise ContractError(f"invalid JSON Schema block: {exc}") from exc
    return values


def extract_schemas(markdown: str) -> dict[str, dict[str, Any]]:
    """Map each schema file name to its document.

    A block is a schema when it is a JSON object with a JSON Schema ``$schema``
    and a string ``$id``. The file name is the last path segment of ``$id``.
    """
    found: dict[str, dict[str, Any]] = {}
    for value in iter_fenced_json(markdown):
        if not isinstance(value, dict):
            continue
        schema_id = value.get("$id")
        dialect = value.get("$schema")
        if not isinstance(schema_id, str) or not isinstance(dialect, str):
            continue
        if not dialect.startswith("https://json-schema.org/"):
            continue
        name = schema_id.rstrip("/").rsplit("/", 1)[-1]
        if "/" in name or not name.endswith(".json"):
            raise ContractError(f"schema $id has no JSON file name: {schema_id}")
        if name in found:
            raise ContractError(f"duplicate schema {name}")
        found[name] = value
    if not found:
        raise ContractError("no JSON Schema blocks found in the contract")
    return found


def assert_schemas_valid(schemas: dict[str, dict[str, Any]]) -> None:
    """Reject documents that are not Draft 2020-12 schemas."""
    for name, schema in schemas.items():
        try:
            Draft202012Validator.check_schema(schema)
        except SchemaError as exc:
            raise ContractError(f"{name} is not a valid JSON Schema: {exc}") from exc


def write_schemas(schemas: dict[str, dict[str, Any]], out_dir: Path) -> list[Path]:
    """Write ``schemas/v1`` files and remove stale JSON left in that directory."""
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for name in sorted(schemas):
        path = out_dir / name
        text = json.dumps(schemas[name], indent=2, ensure_ascii=False) + "\n"
        path.write_text(text, encoding="utf-8", newline="\n")
        written.append(path)
    expected = set(schemas)
    for existing in out_dir.glob("*.json"):
        if existing.name not in expected:
            existing.unlink()
    return written


# --------------------------------------------------------------------------- #
# Directory conformance
# --------------------------------------------------------------------------- #

_JSON_FILES = ("meta", "frames", "coadds", "sed", "gaia")
_SCOPE_RANK = {"epoch_detector": 0, "detector": 1, "channel": 2}
_DICHROIC = (50, 51)
_MAX_SCHEMA_ERRORS = 25


@dataclass(frozen=True)
class Violation:
    """One conformance failure. ``rule`` is a short stable identifier."""

    file: str
    rule: str
    message: str

    def __str__(self) -> str:
        return f"{self.file}: [{self.rule}] {self.message}"


def load_registry(schemas_dir: Path) -> Registry:
    """Registry of every ``*.json`` schema in ``schemas_dir`` keyed by its ``$id``."""
    resources: list[tuple[str, Resource[Any]]] = []
    for path in sorted(schemas_dir.glob("*.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        schema_id = document.get("$id") if isinstance(document, dict) else None
        if not isinstance(schema_id, str):
            raise ContractError(f"{path.name} has no $id")
        resources.append(
            (schema_id, Resource.from_contents(document, default_specification=DRAFT202012))
        )
    if not resources:
        raise ContractError(f"no schemas found in {schemas_dir}")
    return Registry().with_resources(resources)


def _close(a: float, b: float, tol: float = 1e-9) -> bool:
    return math.isclose(a, b, rel_tol=tol, abs_tol=tol)


class _Report:
    def __init__(self) -> None:
        self.items: list[Violation] = []

    def add(self, file: str, rule: str, message: str) -> None:
        self.items.append(Violation(file, rule, message))


def _reject_constant(name: str) -> Any:
    raise ValueError(f"non-finite JSON constant {name}")


def _read_json(path: Path, report: _Report) -> Any | None:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        report.add(path.name, "file_missing", f"cannot read: {exc}")
        return None
    if raw.startswith(b"\xef\xbb\xbf"):
        report.add(path.name, "encoding", "file starts with a UTF-8 BOM")
    if b"\r\n" in raw:
        report.add(path.name, "encoding", "file contains CRLF line endings")
    try:
        return json.loads(raw.decode("utf-8-sig"), parse_constant=_reject_constant)
    except (ValueError, UnicodeDecodeError) as exc:
        report.add(path.name, "json_parse", str(exc))
        return None


def _validate_schema(name: str, document: Any, registry: Registry, report: _Report) -> None:
    uri = f"{SCHEMA_BASE}{name}.schema.json"
    try:
        schema = registry.get_or_retrieve(uri).value.contents
    except Exception as exc:  # referencing raises its own lookup errors
        report.add(f"{name}.json", "schema_missing", f"schema {uri} not in registry: {exc}")
        return
    validator = Draft202012Validator(schema, registry=registry)
    errors = sorted(validator.iter_errors(document), key=lambda e: [str(p) for p in e.absolute_path])
    for error in errors[:_MAX_SCHEMA_ERRORS]:
        where = "/".join(str(p) for p in error.absolute_path) or "<root>"
        report.add(f"{name}.json", "schema", f"{where}: {error.message[:200]}")
    if len(errors) > _MAX_SCHEMA_ERRORS:
        report.add(f"{name}.json", "schema", f"... {len(errors) - _MAX_SCHEMA_ERRORS} more errors")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _nearest_channel(channels: list[dict[str, Any]], lambda_um: float, *, valid_only: bool) -> int:
    best: tuple[float, int] | None = None
    for row in channels:
        index = int(row["channel"])
        if valid_only and index in _DICHROIC:
            continue
        key = (abs(float(row["lambda_um"]) - lambda_um), index)
        if best is None or key < best:
            best = key
    if best is None:
        raise ValueError("empty channel table")
    return best[1]


def validate_directory(
    path: Path,
    registry: Registry,
    *,
    expected_slug: str | None = None,
) -> list[Violation]:
    """Check one ``/data/{slug}/`` directory. An empty list means it conforms.

    ``expected_slug`` is compared with every file's ``slug`` when given (use it for a
    published directory; omit it for a staging directory).
    """
    report = _Report()
    if not (path / "meta.json").is_file():
        report.add("meta.json", "meta_missing", "meta.json does not exist")
        return report.items

    docs: dict[str, Any] = {}
    for name in _JSON_FILES:
        document = _read_json(path / f"{name}.json", report)
        if document is not None:
            docs[name] = document
            _validate_schema(name, document, registry, report)

    meta = docs.get("meta")
    if isinstance(meta, dict):
        _check_common_keys(path, docs, meta, expected_slug, report)
        _check_files_and_binaries(path, meta, docs, report)
    # Invariants assume schema-valid input; skip them when the schema already failed.
    if report.items and any(v.rule in {"schema", "json_parse"} for v in report.items):
        return report.items
    if isinstance(meta, dict) and all(k in docs for k in _JSON_FILES):
        _check_meta(meta, docs, report)
        _check_frames(meta, docs["frames"], report)
        _check_coadds(meta, docs, report)
        _check_sed(docs, report)
        _check_gaia(docs, report)
    return report.items


def _check_common_keys(
    path: Path, docs: dict[str, Any], meta: dict[str, Any], expected_slug: str | None,
    report: _Report,
) -> None:
    slug = meta.get("slug")
    if expected_slug is not None and slug != expected_slug:
        report.add("meta.json", "slug", f"slug {slug!r} != expected {expected_slug!r}")
    for name, doc in docs.items():
        if not isinstance(doc, dict):
            continue
        file = f"{name}.json"
        if doc.get("schema_version") != "1.0.0":
            report.add(file, "schema_version", f"schema_version is {doc.get('schema_version')!r}")
        if doc.get("slug") != slug:
            report.add(file, "slug", f"slug {doc.get('slug')!r} != meta slug {slug!r}")
        if name != "meta" and doc.get("data_version") != meta.get("data_version"):
            report.add(file, "data_version", "data_version differs from meta.json")


def _check_files_and_binaries(
    path: Path, meta: dict[str, Any], docs: dict[str, Any], report: _Report
) -> None:
    files = meta.get("files")
    if isinstance(files, dict):
        for name, entry in files.items():
            target = path / name
            if not target.is_file():
                report.add("meta.json", "file_missing", f"files[{name!r}] does not exist")
                continue
            if not isinstance(entry, dict):
                continue
            if target.stat().st_size != entry.get("bytes"):
                report.add("meta.json", "file_bytes", f"{name}: {target.stat().st_size} bytes on disk, meta says {entry.get('bytes')}")
            if _sha256(target) != entry.get("sha256"):
                report.add("meta.json", "file_sha256", f"{name}: SHA-256 differs from meta.files")

    previews = meta.get("previews")
    if isinstance(previews, dict):
        for key in ("thumb", "rgb_detector", "rgb_equal_channel"):
            rel = previews.get(key)
            if rel is None:
                if (path / "previews" / "rgb_detector.png").exists() and key == "rgb_detector":
                    report.add("meta.json", "preview", "rgb_detector.png exists but meta says null")
            elif isinstance(rel, str) and not (path / rel).is_file():
                report.add("meta.json", "preview", f"{rel} does not exist")

    binaries = meta.get("binaries")
    if not isinstance(binaries, dict):
        return
    counts = {
        "frames": docs.get("frames", {}).get("n_frames") if isinstance(docs.get("frames"), dict) else None,
        "coadds": docs.get("coadds", {}).get("n_coadds") if isinstance(docs.get("coadds"), dict) else None,
    }
    for key in ("frames", "coadds"):
        desc = binaries.get(key)
        if not isinstance(desc, dict):
            continue
        name = f"{key}.bin"
        target = path / name
        n_items, height, width = desc.get("n_items"), desc.get("height"), desc.get("width")
        if not all(isinstance(v, int) for v in (n_items, height, width)):
            continue
        want = binfmt.expected_nbytes(n_items, height, width)
        if desc.get("bytes") != want:
            report.add("meta.json", "binary_bytes", f"binaries.{key}.bytes {desc.get('bytes')} != n*2*H*W*2 = {want}")
        if counts[key] is not None and counts[key] != n_items:
            report.add("meta.json", "binary_items", f"binaries.{key}.n_items {n_items} != {counts[key]} in {key}.json")
        if not target.is_file():
            report.add(name, "file_missing", f"{name} does not exist")
            continue
        data = target.read_bytes()
        if len(data) != want:
            report.add(name, "binary_size", f"{len(data)} bytes on disk, expected {want}")
            continue
        if n_items == 0:
            continue
        array = binfmt.decode_array(data, n_items, height, width)
        mismatch = np.isnan(array[:, 0]) != np.isnan(array[:, 1])
        if mismatch.any():
            item = int(np.argwhere(mismatch)[0][0])
            report.add(name, "nan_planes", f"NaN positions of plane 0 and 1 differ (first at item {item})")
        if np.isinf(array).any():
            report.add(name, "infinity", "file contains +-Infinity")


def _check_meta(meta: dict[str, Any], docs: dict[str, Any], report: _Report) -> None:
    target, grid, center = meta["target"], meta["grid"], meta["center"]
    pm_none = target["pmra_mas_yr"] is None
    if pm_none != (target["pmdec_mas_yr"] is None):
        report.add("meta.json", "pm_pair", "pmra_mas_yr and pmdec_mas_yr must both be null or both set")
    if pm_none != (target["pm_source"] == "none"):
        report.add("meta.json", "pm_source", "proper motions are null iff pm_source == 'none'")
    if (target["pm_reference"] is None) != (target["pm_source"] in {"none", "user"}):
        report.add("meta.json", "pm_reference", "pm_reference is null iff pm_source is 'none' or 'user'")

    if not _close(grid["crval1_deg"], center["ra_deg"]) or not _close(grid["crval2_deg"], center["dec_deg"]):
        report.add("meta.json", "grid_center", "grid.crval1/2 must equal center.ra/dec")
    try:
        want = Grid.build(grid["size_deg"], grid["crval1_deg"], grid["crval2_deg"])
    except ValueError as exc:
        report.add("meta.json", "grid", str(exc))
    else:
        for field in ("width", "height"):
            if grid[field] != getattr(want, field):
                report.add("meta.json", "grid", f"grid.{field} {grid[field]} != {getattr(want, field)}")
        for field in ("crpix1", "crpix2", "cdelt1_deg", "cdelt2_deg"):
            if not _close(grid[field], getattr(want, field)):
                report.add("meta.json", "grid", f"grid.{field} {grid[field]} != {getattr(want, field)}")

    obs = meta["observations"]
    frames = docs["frames"]
    if obs["n_frames"] != frames["n_frames"]:
        report.add("meta.json", "n_frames", "observations.n_frames != frames.json n_frames")
    if obs["n_epochs"] != len(frames["epochs"]):
        report.add("meta.json", "n_epochs", "observations.n_epochs != number of epochs in frames.json")
    for key in ("frames", "coadds"):
        desc = meta["binaries"][key]
        if desc["height"] != grid["height"] or desc["width"] != grid["width"]:
            report.add("meta.json", "binary_shape", f"binaries.{key} height/width differ from grid")
        entry = meta["files"].get(f"{key}.bin")
        if entry and entry["bytes"] != desc["bytes"]:
            report.add("meta.json", "binary_bytes", f"binaries.{key}.bytes != files['{key}.bin'].bytes")
    want_status = "partial" if obs["n_failed_fetches"] > 0 else "complete"
    if meta["status"] != want_status:
        report.add("meta.json", "status", f"status is {meta['status']!r}, expected {want_status!r}")
    detector_rgb_null = docs["coadds"]["rgb_presets"]["detector_rgb"] is None
    if (meta["previews"]["rgb_detector"] is None) != detector_rgb_null:
        report.add("meta.json", "rgb_detector", "previews.rgb_detector is null iff detector_rgb is null")


def _check_frames(meta: dict[str, Any], doc: dict[str, Any], report: _Report) -> None:
    file = "frames.json"
    frames, epochs = doc["frames"], doc["epochs"]
    if doc["n_frames"] != len(frames):
        report.add(file, "n_frames", f"n_frames {doc['n_frames']} != len(frames) {len(frames)}")
    order = [(f["mjd"], f["detector"], f["frame_key"]) for f in frames]
    if order != sorted(order):
        report.add(file, "frame_order", "frames not sorted by (mjd, detector, frame_key)")
    keys = [f["frame_key"] for f in frames]
    if len(set(keys)) != len(keys):
        report.add(file, "frame_key", "frame_key values are not unique")

    gap = meta["processing"]["epoch_gap_days"]
    severe = meta["processing"]["contamination_severe_fraction"]
    channels = meta["channels"]
    epoch_id = -1
    previous: float | None = None
    for position, frame in enumerate(frames):
        if frame["index"] != position:
            report.add(file, "index", f"frames[{position}].index is {frame['index']}")
        if previous is None or frame["mjd"] - previous > gap:
            epoch_id += 1
        previous = frame["mjd"]
        if frame["epoch_id"] != epoch_id:
            report.add(file, "epoch", f"frames[{position}].epoch_id {frame['epoch_id']} != {epoch_id}")
        if not frame["lambda_min_um"] <= frame["lambda_um"] <= frame["lambda_max_um"]:
            report.add(file, "lambda_order", f"frames[{position}]: lambda_min <= lambda <= lambda_max violated")
        want_channel = _nearest_channel(channels, frame["lambda_um"], valid_only=False)
        if frame["channel"] != want_channel:
            report.add(file, "channel", f"frames[{position}].channel {frame['channel']} != nearest {want_channel}")
        fractions = frame["flag_fractions"]
        if (frame["aperture_pixels"] == 0) != (fractions is None):
            report.add(file, "flag_fractions", f"frames[{position}]: flag_fractions is null iff aperture_pixels == 0")
        if frame["aperture_pixels"] == 0 or fractions is None:
            level = 2
        else:
            peak = max(fractions.values(), default=0.0)
            level = 2 if peak >= severe else (0 if peak == 0 else 1)
        if frame["contamination_level"] != level:
            report.add(file, "contamination", f"frames[{position}].contamination_level {frame['contamination_level']} != {level}")

    if sum(e["n_frames"] for e in epochs) != len(frames):
        report.add(file, "epochs", "sum of epochs[*].n_frames != n_frames")
    for position, epoch in enumerate(epochs):
        members = [f for f in frames if f["epoch_id"] == epoch["epoch_id"]]
        if epoch["epoch_id"] != position:
            report.add(file, "epochs", f"epochs[{position}].epoch_id is {epoch['epoch_id']}")
        if epoch["n_frames"] != len(members):
            report.add(file, "epochs", f"epoch {epoch['epoch_id']}: n_frames {epoch['n_frames']} != {len(members)}")
        if epoch["detectors"] != sorted({f["detector"] for f in members}):
            report.add(file, "epochs", f"epoch {epoch['epoch_id']}: detectors not the sorted set of member detectors")
        if members and (
            not _close(epoch["mjd_start"], min(f["mjd"] for f in members))
            or not _close(epoch["mjd_end"], max(f["mjd"] for f in members))
        ):
            report.add(file, "epochs", f"epoch {epoch['epoch_id']}: mjd_start/mjd_end differ from member frames")


def _check_coadds(meta: dict[str, Any], docs: dict[str, Any], report: _Report) -> None:
    file = "coadds.json"
    doc, frames = docs["coadds"], docs["frames"]["frames"]
    coadds = doc["coadds"]
    if doc["n_coadds"] != len(coadds):
        report.add(file, "n_coadds", f"n_coadds {doc['n_coadds']} != len(coadds) {len(coadds)}")

    def sort_key(c: dict[str, Any]) -> tuple[int, int, int, int]:
        return (
            _SCOPE_RANK[c["scope"]],
            -1 if c["epoch_id"] is None else c["epoch_id"],
            -1 if c["detector"] is None else c["detector"],
            -1 if c["channel"] is None else c["channel"],
        )

    if [sort_key(c) for c in coadds] != sorted(sort_key(c) for c in coadds):
        report.add(file, "coadd_order", "coadds not ordered by scope then epoch_id, detector, channel")
    for position, coadd in enumerate(coadds):
        label = f"coadds[{position}]"
        if coadd["index"] != position:
            report.add(file, "index", f"{label}.index is {coadd['index']}")
        indices = coadd["frame_indices"]
        if indices != sorted(indices) or coadd["n_frames"] != len(indices):
            report.add(file, "frame_indices", f"{label}: frame_indices must be sorted with n_frames entries")
        if any(i >= len(frames) for i in indices):
            report.add(file, "frame_indices", f"{label}: frame index out of range")
            continue
        scope, epoch_id, detector, channel = (coadd[k] for k in ("scope", "epoch_id", "detector", "channel"))
        if scope == "epoch_detector":
            ok = epoch_id is not None and detector is not None and channel is None
        elif scope == "detector":
            ok = detector is not None and epoch_id is None and channel is None
        else:
            ok = channel is not None and epoch_id is None and detector == channel // 17 + 1
        if not ok:
            report.add(file, "scope_keys", f"{label}: key fields do not match scope {scope!r}")
        members = [frames[i] for i in indices]
        lambdas = [m["lambda_um"] for m in members]
        if not _close(coadd["lambda_mean_um"], sum(lambdas) / len(lambdas), 1e-6):
            report.add(file, "lambda_mean", f"{label}: lambda_mean_um is not the mean of member lambda_um")
        if not _close(coadd["lambda_min_um"], min(m["lambda_min_um"] for m in members), 1e-6) or not _close(
            coadd["lambda_max_um"], max(m["lambda_max_um"] for m in members), 1e-6
        ):
            report.add(file, "lambda_range", f"{label}: lambda_min/max differ from member frames")

    presets = doc["rgb_presets"]
    equal = presets["equal_channel_rgb"]
    want_equal = {
        "blue_channels": list(range(0, 33)),
        "green_channels": [*range(33, 50), *range(52, 68)],
        "red_channels": list(range(68, 102)),
    }
    for key, want in want_equal.items():
        if equal[key] != want:
            report.add(file, "equal_channel_rgb", f"{key} differs from the v1 constant")

    n_detector_scope = sum(1 for c in coadds if c["scope"] == "detector")
    detector_rgb = presets["detector_rgb"]
    if (detector_rgb is None) != (n_detector_scope < 3):
        report.add(file, "detector_rgb", "detector_rgb is null iff fewer than three detector-scope coadds")
    if detector_rgb is not None:
        flat = [d for g in ("blue", "green", "red") for d in detector_rgb[g]]
        if flat != sorted(set(flat)):
            report.add(file, "detector_rgb", "detector groups must be disjoint, ascending, blue to red")

    markers = meta["processing"]["line_markers"]
    lines = presets["feature_lines"]
    valid = [int(r["channel"]) for r in meta["channels"] if int(r["channel"]) not in _DICHROIC]
    for marker, line in zip(markers, lines, strict=True):
        if line["name"] != marker["name"] or not _close(line["lambda_um"], marker["lambda_um"]):
            report.add(file, "feature_lines", f"{line['name']}: differs from processing.line_markers")
            continue
        on = _nearest_channel(meta["channels"], marker["lambda_um"], valid_only=True)
        if line["on_channel"] != on:
            report.add(file, "feature_lines", f"{line['name']}: on_channel {line['on_channel']} != {on}")
            continue
        at = valid.index(on)
        want_continuum = [*valid[max(0, at - 2) : at], *valid[at + 1 : at + 3]]
        if sorted(line["continuum_channels"]) != want_continuum:
            report.add(file, "feature_lines", f"{line['name']}: continuum_channels != {want_continuum}")


def _check_sed(docs: dict[str, Any], report: _Report) -> None:
    file = "sed.json"
    sed, frames = docs["sed"], docs["frames"]["frames"]
    points = sed["points"]
    if sed["n_points"] != len(points) or len(points) != len(frames):
        report.add(file, "n_points", "n_points must equal len(points) and the number of frames")
        return
    shared = ("epoch_id", "detector", "channel", "mjd", "obs_time_utc", "lambda_um", "bandwidth_um")
    for position, (point, frame) in enumerate(zip(points, frames, strict=True)):
        if point["frame_index"] != position:
            report.add(file, "frame_index", f"points[{position}].frame_index is {point['frame_index']}")
        for key in shared:
            if point[key] != frame[key]:
                report.add(file, "frame_fields", f"points[{position}].{key} differs from frames[{position}]")
        if point["flagged"] != (frame["contamination_level"] != 0):
            report.add(file, "flagged", f"points[{position}].flagged != (contamination_level != 0)")
        flux, err = point["flux_mjy"], point["flux_err_mjy"]
        if len(flux) != 3 or len(err) != 3:
            report.add(file, "flux_len", f"points[{position}]: flux arrays need 3 entries")
        elif any((a is None) != (b is None) for a, b in zip(flux, err, strict=True)):
            report.add(file, "flux_null", f"points[{position}]: flux and flux_err must be null together")
        centroid = (point["centroid_x"], point["centroid_y"], point["centroid_err_px"])
        if len({v is None for v in centroid}) != 1:
            report.add(file, "centroid_null", f"points[{position}]: centroid triple must be null together")


def _check_gaia(docs: dict[str, Any], report: _Report) -> None:
    file = "gaia.json"
    gaia, epochs = docs["gaia"], docs["frames"]["epochs"]
    sources = gaia["sources"]
    match_radius = gaia["match_radius_arcsec"]
    if gaia["n_sources_in_cone"] != len(sources):
        report.add(file, "n_sources", "n_sources_in_cone != len(sources)")
    separations = [s["separation_arcsec"] for s in sources]
    if separations != sorted(separations):
        report.add(file, "source_order", "sources not sorted by separation_arcsec ascending")
    primary = next((s for s in sources if s["separation_arcsec"] <= match_radius), None)
    want_id = primary["source_id"] if primary else None
    if gaia["primary_source_id"] != want_id:
        report.add(file, "primary", f"primary_source_id {gaia['primary_source_id']!r} != {want_id!r}")
    flagged = [s["source_id"] for s in sources if s["is_primary"]]
    if flagged != ([want_id] if want_id else []):
        report.add(file, "is_primary", "exactly the primary source must have is_primary = true")
    for source in sources:
        track = source["predicted_track"]
        if source["source_id"] == want_id:
            if track is None or [t["epoch_id"] for t in track] != [e["epoch_id"] for e in epochs]:
                report.add(file, "predicted_track", "primary source needs one track entry per epoch")
        elif track is not None:
            report.add(file, "predicted_track", f"non-primary source {source['source_id']} has a track")

    measured, consistency = gaia["measured_pm"], gaia["consistency"]
    has_gaia_pm = primary is not None and primary["pmra_mas_yr"] is not None and primary["pmdec_mas_yr"] is not None
    if (consistency is not None) != (measured is not None and has_gaia_pm):
        report.add(file, "consistency", "consistency is non-null iff measured_pm and primary Gaia pm exist")
    if consistency is not None and measured is not None and primary is not None:
        d_ra = measured["pmra_mas_yr"] - primary["pmra_mas_yr"]
        d_dec = measured["pmdec_mas_yr"] - primary["pmdec_mas_yr"]
        if not _close(consistency["delta_pmra_mas_yr"], d_ra, 1e-6) or not _close(consistency["delta_pmdec_mas_yr"], d_dec, 1e-6):
            report.add(file, "consistency", "delta_* != measured - Gaia")
        within = math.hypot(d_ra, d_dec) <= 3.0 * consistency["sigma_combined_mas_yr"]
        if consistency["within_3_sigma"] != within:
            report.add(file, "consistency", "within_3_sigma disagrees with hypot(delta) <= 3 * sigma_combined")

    if gaia["query_status"] == "unavailable":
        want_verdict = "unavailable"
        if sources or gaia["primary_source_id"] or measured or consistency or gaia["n_sources_in_cone"]:
            report.add(file, "unavailable", "unavailable result must have no sources, primary, pm, or consistency")
    elif want_id is None:
        want_verdict = "no_counterpart"
    elif consistency is not None and not consistency["within_3_sigma"]:
        want_verdict = "match_inconsistent"
    else:
        want_verdict = "match_consistent"
    if gaia["verdict"] != want_verdict:
        report.add(file, "verdict", f"verdict {gaia['verdict']!r} != {want_verdict!r}")
