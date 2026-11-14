# FRONTEND_SPEC.md - SPHEREx Sky Explorer

**Spec version:** `1.0.0` (Canonical v1)
**Conforms to:** `DATA_CONTRACT.md` `1.0.0` and `NASA_Final_Architecture.pdf` (Canonical v1).
**Normative keywords:** MUST, MUST NOT, SHOULD, MAY as in RFC 2119.
**Authority:** Every data shape, unit, axis order and endpoint is defined in `DATA_CONTRACT.md` and is referenced here as `DC §n`. This document MUST NOT be read as redefining any of them. On conflict, `DATA_CONTRACT.md` wins.

---

## 1. Scope and principles

| # | Principle |
|---|---|
| P1 | Aladin Lite is the **map** (navigation, footprint, Gaia overlay). Frames, differences and RGB are drawn on a plain HTML5 Canvas in the **lab** sidebar. Cutout stacks MUST NOT be pushed through Aladin's layer system. |
| P2 | The browser does arithmetic (stretch, blink, difference, RGB mix, plotting). Astronomy (WCS, reprojection, flags, photometry, Gaia matching) is read from precomputed files and never recomputed, except the closed-form world-to-pixel mapping of `DC §3.2` for overlays. |
| P3 | Tier 1, Tier 1.5 and Tier 2 share one code path. The client differs only in how a dataset arrives (static files vs job + SSE). After arrival the dataset is identical. |
| P4 | Stack in the dimension you do not want to see. Blink within one detector and one wavelength window, never across mixed wavelengths. |
| P5 | The view is fully described by the URL (section 5). |
| P6 | Quick-look only. Every photometry view carries the label "Quick-look from L2 cutouts". |

Non-goals in v1: matched filter, shift-and-add, PSF aperture correction, server-side RGB or difference generation beyond the PNG previews in `DC §2`, NEOSSat.

---

## 2. Tech stack

| Concern | Choice |
|---|---|
| Language | TypeScript 5.x, `strict: true`, `noUncheckedIndexedAccess: true`, no `any` in `src/core`. |
| UI | React 18, function components, hooks only. |
| Styling | Tailwind CSS 3.x with design tokens in `tailwind.config.ts` (section 15). No CSS-in-JS. |
| Build | Vite 5, ES2022 target, `build.sourcemap: true`. |
| State | Zustand (single store, slice per concern). URL is the source of truth for `ra`, `dec`, `fov`, `tool` (section 5). |
| Map | `aladin-lite` npm package, major version 3, version pinned exactly in `package.json`. |
| Plots | Hand-written Canvas 2D for images; SVG for SED and lambda-time axes using only `d3-scale`, `d3-array`, `d3-format`. No charting framework. |
| Hashing | `crypto.subtle.digest("SHA-256")`. |
| Tests | Vitest (unit), Playwright (e2e), `@testing-library/react` (components). |
| Lint | ESLint (`@typescript-eslint`, `react-hooks`, `jsx-a11y`), Prettier. |
| Runtime deps outside the list above | MUST NOT be added without a spec revision. |

Browser baseline: evergreen Chrome, Firefox, Safari (current and previous major). Required APIs: `fetch` streaming (`ReadableStream`), `TextDecoder`, `crypto.subtle`, `OffscreenCanvas` (optional, falls back to `HTMLCanvasElement`), `ResizeObserver`.

### 2.1 Environment variables (build time)

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE` | `""` (same origin) | Prefix for `/api/*`. |
| `VITE_DATA_BASE` | `""` (same origin) | Prefix for `/data/*`. |
| `VITE_HIPS_SURVEY_BASE` | Aladin default survey id | Base layer shown in the map. |
| `VITE_FEATURE_G1_CUBE` | `false` | Gate G1 (section 8.4). |
| `VITE_SPHEREX_CUBE_HIPS_URL` | unset | HiPS cube URL used only when G1 is open. |
| `VITE_IRSA_SPECTROPHOTOMETRY_URL` | unset | Link-out target; button hidden when unset. |
| `VITE_IRSA_MOST_URL` | unset | Link-out target for solar-system movers; hidden when unset. |

Dev server proxies `/api` and `/data` to the backend. No other origin is contacted by application code. Browser access to IRSA is never made; all IRSA traffic goes through the backend.

---

## 3. Directory layout

```
frontend/
  index.html
  package.json
  vite.config.ts
  tailwind.config.ts
  tsconfig.json
  src/
    main.tsx
    App.tsx
    config/
      env.ts                  typed env access
      tools.ts                Tool enum, labels, keyboard shortcuts
      constants.ts            numeric constants of section 16
      copy.ts                 all user-facing strings (verdicts, errors, glossary)
    contract/                 generated, read-only
      types.ts                TS types generated from the JSON Schemas of DC §§4-9, 11, 12
      validate.ts             light runtime guards (schema_version, required keys)
    core/                     pure functions, no React, no DOM
      half.ts                 float16 decode LUT (DC §10.1)
      binary.ts               item/plane views over frames.bin and coadds.bin
      wcs.ts                  worldToPixel, propagate (DC §3.1, §3.2)
      stretch.ts              percentiles, asinh
      blink.ts                frame selection, windowed coadd
      diff.ts                 difference, significance, contours
      rgb.ts                  inverse-variance compositor, presets
      epochs.ts               epoch lookups, colour assignment
      flags.ts                contamination helpers
      sed.ts                  SED and lambda-time data shaping
      contour.ts              marching squares
      hash.ts                 sha256 helper
    data/
      loader.ts               static dataset loader and integrity checks
      dataset.ts              Dataset type and derived indexes
      registry.ts             Tier 1 / 1.5 slug list and metadata prefetch
      jobs.ts                 POST /api/jobs client
      sse.ts                  fetch-based SSE client
      jobRunner.ts            job state machine (section 7)
    state/
      store.ts                Zustand store
      urlSync.ts              URL <-> store (section 5)
    map/
      AladinMap.tsx
      aladinAdapter.ts        thin wrapper, the only file importing aladin-lite
      cubeLayer.ts            Gate G1 adapter
      gaiaOverlay.ts
      footprint.ts
    lab/
      Lab.tsx                 sidebar shell and tool tabs
      FrameCanvas.tsx         shared canvas viewport (pan, zoom, overlays)
      tools/
        BlinkTool.tsx
        DiffTool.tsx
        RgbTool.tsx
        SedTool.tsx           SED + lambda-time
        GaiaPanel.tsx
      widgets/
        TimeSlider.tsx
        DetectorPicker.tsx
        WavelengthWindow.tsx
        ChannelRgbEditor.tsx
        Legend.tsx
    jobs/
      JobProgress.tsx
      JobErrors.tsx
    ui/                       buttons, tabs, tooltips, toasts, skeletons
    styles/index.css
  tests/
    unit/
    e2e/
```

Rules: `src/core` and `src/data` MUST NOT import React. Only `map/aladinAdapter.ts` imports `aladin-lite`. Only `contract/` knows schema field names as TypeScript types; other modules import those types.

---

## 4. Application model

### 4.1 Dataset

A `Dataset` is the in-memory result of loading `/data/{slug}/` (`DC §2`, `DC §13`):

| Member | Source |
|---|---|
| `meta` | `meta.json` |
| `frames` | `frames.json` (`frames[]`, `epochs[]`) |
| `coadds` | `coadds.json` (`coadds[]`, `rgb_presets`) |
| `sed` | `sed.json` |
| `gaia` | `gaia.json` |
| `frameBuf`, `coaddBuf` | `ArrayBuffer` of `frames.bin`, `coadds.bin`, wrapped as `Uint16Array` (little-endian, host must be little-endian; assert at startup) |
| `previews` | URLs of PNGs from `meta.previews` |

Derived indexes built once on load: `framesByDetector[1..6]` (sorted by `mjd`), `epochById`, `frameByKey`, `coaddByKey` (keys: `ed:{epoch}:{det}`, `d:{det}`, `c:{channel}`), `sedByFrame` (array aligned to `frames`), `epochColor[epoch_id]`.

### 4.2 Store slices

| Slice | State |
|---|---|
| `view` | `ra`, `dec`, `fov` (mirrors URL) |
| `tool` | `tool` (mirrors URL), per-tool UI state (sections 10-14) |
| `dataset` | `slug`, `status: idle \| loading \| ready \| error`, `dataset` |
| `job` | `JobRunner` state (section 7) |
| `ui` | `embed`, `reducedMotion`, `toasts` |

Datasets are immutable after `ready`. A new `data_version` replaces the whole dataset.

---

## 5. URL state sync

### 5.1 Parameters

| Param | Type | Range / values | Default | Meaning |
|---|---|---|---|---|
| `ra` | float | `[0, 360)` | target of dataset, else `0` | Map centre, ICRS degrees. |
| `dec` | float | `[-90, 90]` | target of dataset, else `0` | Map centre, ICRS degrees. |
| `fov` | float | `[0.01, 180]` | `0.5` | Map field of view, degrees (the larger axis). |
| `tool` | enum | `map`, `blink`, `diff`, `rgb`, `sed`, `gaia` | `map` | Active tool. `map` means the lab is closed. |
| `slug` | string | `DC §2.1` pattern | unset | Dataset to load. |
| `embed` | `1` | `1` or absent | absent | Embed mode (section 5.4). |

`slug` and `embed` are additions to the four required parameters; unknown parameters MUST be preserved untouched.

### 5.2 Parse and validate

1. Parse `location.search` with `URLSearchParams`.
2. Non-finite numbers are discarded. `ra` is wrapped modulo 360 into `[0, 360)`. `dec` and `fov` are clamped to their ranges. Unknown `tool` becomes `map`. `slug` failing the `DC §2.1` regex is discarded.
3. Serialization precision: `ra`, `dec` to 6 decimals, `fov` to 4 decimals, trailing zeros trimmed.
4. Parameter order on write: `ra`, `dec`, `fov`, `tool`, `slug`, `embed`, then any unknown parameters in original order.

### 5.3 Sync rules

| Event | History action |
|---|---|
| Map pan or zoom (Aladin `positionChanged`, `zoomChanged`) | `history.replaceState`, debounced 250 ms |
| `tool` change | `history.pushState` |
| `slug` change (dataset selection or job result) | `history.pushState` |
| `popstate` | Parse URL, write to store, command Aladin to `gotoRaDec` / set FoV without echoing back to the URL |

Loop prevention: a `suppressUrlWrite` counter is set while the store applies a URL-originated change; Aladin events fired during that interval are ignored.

Boot sequence: parse URL, then (a) if `slug` present, load dataset (section 6), and if `ra`/`dec` absent, centre on `meta.center`; (b) else if `tool != map` and `ra`/`dec` present, create a Tier 2 job for that coordinate with default `size_deg = 0.1` (section 7) and replace the URL `slug` on acceptance; (c) else show the map only.

Grid-size selection (`size_deg` in `{0.05, 0.1, 0.2}`) is UI state of the "Analyze this position" action and is not in the URL; the resulting `slug` is.

### 5.4 Embed mode

`embed=1` hides the header, target picker and footer, keeps the tool tabs, and removes all outbound navigation except link-out buttons (which open with `rel="noopener"`). URL sync is unchanged. The page posts no messages to the parent.

---

## 6. Dataset loading and integrity

### 6.1 Static load (Tier 1, Tier 1.5, cached Tier 2, post-job)

Base URL is `{VITE_DATA_BASE}/data/{slug}/`.

1. `GET meta.json` (no `?v`, served `no-cache`, `DC §13`). Reject unless `schema_version` has major `1`, `slug` equals the requested slug, and `status` is `complete` or `partial`. `404` means the dataset does not exist (`DC §13`, not served without `meta.json`).
2. Fetch the other six files from `meta.files` keys in parallel with `?v={meta.data_version}` appended (immutable caching, `DC §13`). The four JSON files and two `.bin` files are required; failure of any is fatal for the dataset.
3. Verify each file:
   - `byteLength == meta.files[name].bytes`.
   - `.bin` files additionally: `byteLength == meta.binaries.frames.bytes` / `meta.binaries.coadds.bytes` (`DC §10.1`, mandatory rejection otherwise).
   - SHA-256 of the received bytes equals `meta.files[name].sha256` (`DC §5.3`, item 9). `fetch` returns decoded bytes, which equal the file bytes even if `Content-Encoding: gzip` was used.
   - After a job (section 7), also verify `meta.json` itself against `complete.files["meta.json"]`.
4. Verify cross-file consistency: every JSON `data_version` and `slug` equal those of `meta.json`; `frames.n_frames == meta.observations.n_frames == meta.binaries.frames.n_items`; `coadds.n_coadds == meta.binaries.coadds.n_items`; `sed.n_points == frames.n_frames`; `meta.grid.width/height == meta.binaries.*.width/height`.
5. Unknown fields are ignored (`DC §1`, tolerant consumers). A different major version is fatal with the "unsupported data version" message.
6. PNG previews (`DC §2`) are loaded lazily as `<img>`/`ImageBitmap` from `meta.previews.*` paths, with `?v=`. `rgb_detector` is `null` means the Detector RGB preset is disabled (`DC §5.3`, item 7).

On failure of any check: status `error`, no partial dataset is exposed, message from `copy.ts` (`integrity_failed`, `not_found`, `unsupported_version`).

`meta.status == "partial"` shows a persistent banner: "N frames could not be fetched" using `meta.observations.n_failed_fetches`; the list `failed_source_uris` is available in an expandable details block.

### 6.2 Registry

`registry.ts` holds the fixed slugs of `DC §2.1` for `tier1` and `tier1_5`. At startup the client fetches each `meta.json` (small) to obtain `title`, `center` and `previews.thumb`. A failing entry is shown disabled. No coordinates are hard-coded in the client.

### 6.3 Binary access

`core/binary.ts` implements the offset formula of `DC §10.1` exactly:

```
elementIndex(f, p, y, x) = (((f * 2 + p) * H + y) * W + x)        // in uint16 units
```

`H`, `W` come from `meta.binaries.*`. The `Uint16Array` view is created with byte offset 0 over the verified buffer. `halfToFloat` is implemented once as a 65536-entry `Float32Array` lookup table built from the reference function of `DC §10.1`; decoding a plane is `out[i] = LUT[u16[base + i]]`. NaN follows the contract rule (all-ones exponent, non-zero mantissa). The unit test suite MUST include the verification vector of `DC §10.3`.

`getPlane(buf, item, plane): Float32Array` returns an `H*W` array in **binary order** (`y = 0` southernmost). Decoded planes are cached in an LRU (capacity `DECODE_CACHE_ITEMS`, section 16). Items are never mutated.

---

## 7. Tier 2 jobs and SSE client

### 7.1 Creating a job

`POST {VITE_API_BASE}/api/jobs` with `Content-Type: application/json` and a body conforming to `DC §11.1`. The client sends only fields the user set: `ra_deg`, `dec_deg`, `size_deg`, and optionally `name`, `pmra_mas_yr`, `pmdec_mas_yr`, `coord_epoch_year`, `force_refresh`.

Client-side pre-validation mirrors `DC §11.2`: both proper motions set or both empty; `size_deg` one of `0.05, 0.1, 0.2`; `ra_deg` in `[0,360)`; `dec_deg` in `[-90,90]`.

| Response | Client behaviour |
|---|---|
| `200` (`cached: true`, `status: complete`) | Skip streaming. Run static load (section 6.1) with `data_base_url`. Optionally open `events_url` only to obtain `complete.files` for integrity checks (the stream is `job_state(complete)` then `complete`, `DC §12.2`); if the stream fails, fall back to `meta.files` alone. |
| `202` (`joined` true or false) | Store `job_id`, `slug`, `events_url`, `data_base_url`; open the SSE stream (7.2). If `joined`, show "Joined an existing job". |
| `400`, `415`, `500` | Error toast and inline error (`copy.ts`), no retry. |
| `422` | Map each `error.details[].field` to its form control and show `issue` inline. |
| `429` | Read `Retry-After` (seconds). Disable the submit button with a visible countdown, then re-enable. Offer Tier 1.5 targets meanwhile (section 7.5). |

The URL gets `slug` from the response immediately (section 5.3, `pushState`).

### 7.2 Stream transport

Native `EventSource` is NOT used because it cannot send `Last-Event-ID` on a client-initiated reconnect. `data/sse.ts` implements SSE over `fetch`:

1. `fetch(events_url, { headers: { Accept: "text/event-stream", "Last-Event-ID": String(lastId) /* omitted when no event processed */ }, signal })`.
2. `404` (`error.code = "not_found"`, `DC §12.1`): fatal, message "Job not found or expired".
3. Read `response.body` with a `TextDecoder("utf-8", { stream: true })`. Buffer text and split on blank lines (`\n\n`, also accept `\r\n\r\n`). Per message, lines are processed as:
   - starts with `:` : comment (keep-alive), updates `lastActivity`, ignored otherwise;
   - `retry: <int>`: sets reconnect delay (server value is 3000);
   - `id: <int>`, `event: <type>`, `data: <json>` (a message has at most one `data` line, `DC §12.1`).
4. Dispatch only if `id > lastId`; then `lastId = id`. Duplicates and replays with `id <= lastId` are dropped.
5. `JSON.parse(data)`; a parse failure is logged and the event dropped (never fatal).
6. After `complete` or `failed` the server closes the stream; the client treats that as normal termination and MUST NOT reconnect.
7. Any other stream end or network error: reconnect after `max(retry, 3000)` ms with `Last-Event-ID: lastId`, exponential factor 1.5 per consecutive failure, capped at 15 s. Give up after `SSE_MAX_RECONNECTS` consecutive failures (section 16) and surface "Connection lost" with a Resume button that restarts at step 1.
8. Watchdog: if no bytes (including keep-alives, which arrive every 15 s) for `SSE_STALL_MS`, abort and reconnect via step 7.
9. `AbortController` is aborted when the job view unmounts or the user cancels (cancel only detaches the client; the job continues on the server).

### 7.3 Event handling

| Event | Store effect | UI |
|---|---|---|
| `job_state` | `status`, `queue_position` | Queue badge "Position n" when `queued`. |
| `stage` | stage table `{discover, fetch_process, aggregate, gaia, export}` set to `running` / `done`, `elapsed_s` | Five-step stepper. |
| `discovery` | `n_exposures`, `releases`, `detectors`, `tap_elapsed_s` | Summary chips (counts per release and detector). |
| `progress` | `{total, done, failed}` | Determinate bar `done / total`, text "37/84 frames", failed count in warning colour. Updates are throttled to one render per animation frame. |
| `frame` | Append to provisional list (7.4) | Live preview thumbnail and running frame counter. |
| `warning` | Append to warning list | Collapsible log; see 7.6. |
| `complete` | Store `files`, `data_version`, `result_status`, counts | Switch to static load (section 6.1) using `data_base_url`. |
| `failed` | Store `code`, `message`, `retryable` | Error panel (7.6). |

Events outside the documented order are processed by type regardless of order; `complete` and `failed` are terminal in all cases.

### 7.4 Streamed frames

A `frame` event carries `frame` (the `frames.json` frame without `index` and `epoch_id`) and `pixels` (`DC §12.3`). Handling:

1. Check `pixels.encoding == "base64"`, `dtype == "float16"`, `byte_order == "little"`, `shape == [2, H, W]` with `H`, `W` equal to the first frame's shape. Mismatch drops the frame with a warning toast.
2. Decode with `atob` into a `Uint8Array`, then view as `Uint16Array` (length `2*H*W`). Expected byte length `2*H*W*2`; otherwise drop.
3. Keep `{seq_frame, frame, u16}` in an arrival-ordered list. The list is a **preview only**: it drives the live thumbnail strip (rendered with the pipeline of section 9 on plane 0) and nothing else. Provisional frames have no `index` or `epoch_id`; no analytical tool is enabled until the final dataset is loaded.
4. After the static load, the arrival list is discarded. Canonical order and indices come from `frames.json`; the optional consistency check matches streamed frames to canonical ones by `frame_key` and logs (not blocks) a mismatch (`DC §12.4`, item 2).

Memory cap: at most `STREAM_PREVIEW_MAX` frames are retained; beyond it only counters are updated.

### 7.5 Fallbacks and demo safety

- Slow job: after `JOB_SLOW_MS` without `done` increasing, show a non-blocking hint with Tier 1.5 targets as one-click alternatives (`tutorial-m101`, `tutorial-cosmos`, `tutorial-intro`, `tutorial-hips`).
- Any Tier 1 or Tier 1.5 target is available with no API call at all (section 6).

### 7.6 Warnings and failures

| `warning.code` | Handling |
|---|---|
| `fetch_retry` | Log line only; counter "retries". |
| `fetch_failed` | Log line; failed counter; result will be `partial` (banner, section 6.1). |
| `wavelength_gradient` | One-time info chip: "Wavelength varies across the cutout more than one bandwidth; per-frame lambda is evaluated at the target position." Not an error. |
| `gaia_unavailable` | Info chip; Gaia panel will show the `unavailable` verdict (section 14). |

| `failed.code` | Message key | Actions |
|---|---|---|
| `no_coverage` | `no_coverage` | "No SPHEREx exposures overlap this position in the configured releases." Buttons: pick another position, open Tier 1.5 targets. |
| `upstream_unavailable` | `upstream_unavailable` | Shown with `retryable`; Retry button re-POSTs the same request with `force_refresh: false`. |
| `timeout` | `timeout` | Same as above. |
| `internal_error` | `internal_error` | Not retryable by default; shows `job_id` for support. |

`retryable: false` hides the Retry button regardless of code.

---

## 8. Aladin Lite v3 integration

### 8.1 Adapter contract

`map/aladinAdapter.ts` is the sole importer of `aladin-lite`. It exposes:

```ts
interface MapAdapter {
  init(el: HTMLElement, opts: { ra: number; dec: number; fov: number; survey: string }): Promise<void>;
  gotoRaDec(ra: number, dec: number): void;
  setFov(deg: number): void;
  getView(): { ra: number; dec: number; fov: number };
  onViewChange(cb: (v: { ra: number; dec: number; fov: number }) => void): () => void;
  onClick(cb: (ra: number, dec: number) => void): () => void;
  setFootprint(poly: Array<[number, number]> | null): void;
  setGaiaSources(src: GaiaMapSource[]): void;       // section 8.3
  setGaiaTrack(track: Array<[number, number]> | null): void;
  setCube(cfg: CubeConfig | null): Promise<void>;    // section 8.4
  destroy(): void;
}
```

Implementation notes (Aladin Lite v3 API):

- Initialise through `A.init.then(() => A.aladin(el, { survey, fov, target: "ra dec", cooFrame: "ICRSd", showCooGrid: false, showFrame: false, showFullscreenControl: false }))`. `ICRSd` keeps all positions in decimal-degree ICRS, matching `DC §1`.
- Navigation: `aladin.gotoRaDec(ra, dec)`, `aladin.setFoV(fov)`, `aladin.getRaDec()`, `aladin.getFoV()` (use `max` of the returned pair).
- Events: `aladin.on("positionChanged", ...)` and `aladin.on("zoomChanged", ...)`; both feed `onViewChange`. `aladin.on("click", ...)` feeds `onClick` using `aladin.pix2world`.
- Overlays use `A.catalog`, `A.source`, `A.graphicOverlay`, `A.polygon`, `A.polyline` added with `aladin.addCatalog` / `aladin.addOverlay`.
- Any API difference found in a pinned version is absorbed inside the adapter. The rest of the app MUST NOT change.

### 8.2 Behaviour

| Feature | Rule |
|---|---|
| Base layer | `VITE_HIPS_SURVEY_BASE`, single optical/IR survey. |
| Click on map | Sets a pending position and opens the "Analyze this position" popover: size selector (`0.05 / 0.1 / 0.2` deg), optional name, optional proper motion pair, optional epoch year, Submit (section 7.1). |
| Target markers | One marker per registry entry (section 6.2) at `meta.center`; click loads that dataset. |
| Footprint | When a dataset is ready, a polygon of the grid boundary: corners `(x, y) = (-0.5,-0.5), (W-0.5,-0.5), (W-0.5,H-0.5), (-0.5,H-0.5)` converted with `pixelToWorld` (section 9.3). |
| Zoom floor | `fov` below `0.01` deg is clamped. Zooming past the cube's native HiPS order only upsamples; native resolution is available in the lab. |
| Resize | A `ResizeObserver` triggers Aladin's own resize handling. |
| Failure | If Aladin fails to initialise (WebGL missing), show a static fallback: coordinate form plus the target picker. The lab remains usable. |

### 8.3 Gaia overlay (map)

Source data: `gaia.json` (`DC §9`), only when `query_status == "ok"`.

| Element | Rule |
|---|---|
| Source markers | One circle per `sources[]` entry, at `(ra_deg, dec_deg)`. These positions are at `ref_epoch_year`, not at `meta.center.t_mid_mjd`; markers are labelled "Gaia position at epoch {ref_epoch_year}". |
| Marker size | Fixed 8 px; primary source 12 px with a distinct ring. Brightness is not encoded in size in v1. |
| Primary | The source with `is_primary == true` is drawn with the verdict colour (section 14.2). |
| Predicted track | If the primary has `predicted_track`, draw a polyline through `(ra_deg, dec_deg)` in array order, with a point per entry labelled `epoch {epoch_id}`. |
| Popup | `source_id` (string, copy button), `phot_g_mean_mag`, `parallax_mas`, proper motion, `separation_arcsec`. `null` values show "n/a". |
| Toggle | "Gaia" layer switch in the map toolbar, on by default whenever a dataset with `query_status == "ok"` is loaded. |

Source IDs MUST remain strings end to end (`DC §1`).

### 8.4 Gate G1: HiPS cube toggle

Gate G1 covers the all-sky SPHEREx HiPS cube (6 bands x 17 channels, a mosaic with no time axis). Whether Aladin Lite v3 renders HiPS cubes is unverified, so the feature is gated.

| Aspect | Rule |
|---|---|
| Flag | `VITE_FEATURE_G1_CUBE`. When `false` the "Cube" control is not rendered and `cubeLayer.ts` is not loaded. |
| Probe | When the flag is `true`, `cubeLayer.probe()` runs once after Aladin init: it loads `VITE_SPHEREX_CUBE_HIPS_URL` as an image layer with a 10 s timeout and confirms that a channel (slice) change re-renders. Probe failure disables the control and shows no error to the user (logged). |
| Control | A toggle "SPHEREx cube" plus a channel slider (`channel` 0..101) and a band/channel readout. Slider steps over valid channels only. |
| Channel to cube frame | Cube frame index equals `channel` (`DC §3.3`: `17 * (band - 1) + (band_channel - 1)`). Channels `50` and `51` (dichroic) are skipped by the slider and, if reached by keyboard, show "Dichroic channel, no data". |
| Wavelength label | `meta.channels[channel].lambda_um` and `bandwidth_um` (when `null`, omit bandwidth). The label is available from any loaded dataset because `meta.channels` is constant; before a dataset is loaded the label is omitted. |
| Coexistence | Cube layer is a base image layer replacement; Gaia overlay and footprint stay on top. Turning the toggle off restores the base survey. |
| Disclosure | Always shown beside the control: "Mosaic, visualization only, no time axis; striping near Pa-alpha, 3.3 um PAH and Br-alpha." |
| Scope | The cube is never an input to blink, difference, RGB or SED. Those tools use only `frames.bin` and `coadds.bin`. |

---

## 9. Canvas rendering core

### 9.1 Coordinate conventions (authoritative for all canvas code)

| Space | Origin and direction | Source |
|---|---|---|
| Binary array `[y][x]` | `y = 0` southernmost row, `x = 0` easternmost column (`DC §3.2`, `DC §10.1`) | `frames.bin`, `coadds.bin` |
| Canvas / ImageData | Row `0` at the top, column `0` at the left | HTML5 Canvas |
| PNG previews | Row `0` is the northern row, column `0` easternmost (`DC §3.2`) | `previews/*.png` |

Because Canvas rows grow downward and binary rows grow northward, **every conversion from a binary array to a canvas MUST flip vertically**:

```
canvasRow(y) = H - 1 - y          (equivalently y = H - 1 - canvasRow)
canvasCol(x) = x                  (no horizontal flip; east is left, as displayed with north up)
```

PNG previews are already in canvas orientation and MUST be drawn without any flip. The flip is implemented in exactly one place, `core/binary.ts::toCanvasOrder(plane, H, W)`, which returns an array in canvas order. No other module flips.

`toCanvasOrder` loop:

```ts
for (let r = 0; r < H; r++) {
  const srcRow = (H - 1 - r) * W;
  const dstRow = r * W;
  for (let c = 0; c < W; c++) dst[dstRow + c] = src[srcRow + c];
}
```

Unit test: an `H x W` array whose value equals `y` for every `x` must come out with the top canvas row equal to `H - 1`; a frame whose single bright pixel is at `(x, y) = (0, 0)` must land at canvas `(col 0, row H - 1)` (bottom-left, south-east corner as seen north-up, east-left).

### 9.2 Overlay coordinates

Overlays are drawn in an offscreen-pixel space where pixel `(x, y)` occupies `[x, x+1] x [row, row+1]` in canvas units with `row = H - 1 - y`. A continuous grid position `(x, y)` from the contract (pixel centres at integers, `DC §3.2`) maps to:

```
u = x + 0.5
v = H - 0.5 - y
```

Radii in pixels are unchanged (aperture 3, 4, 5 px; annulus 6 to 10 px). The grid centre `(W/2 - 0.5, H/2 - 0.5)` maps to `(W/2, H/2)`.

### 9.3 World to pixel and back

`core/wcs.ts` implements, with identical formulas:

- `worldToPixel(ra, dec, grid)` exactly as `DC §3.2` (World to pixel), using `crval1_deg, crval2_deg, crpix1, crpix2, cdelt1_deg, cdelt2_deg` from `meta.grid`. Returns `null` when `D <= 0` (behind the tangent plane).
- `pixelToWorld(x, y, grid)`, the inverse TAN deprojection (angles in radians internally):

```
xi  = (x - (crpix1 - 1)) * cdelt1_deg * pi/180
eta = (y - (crpix2 - 1)) * cdelt2_deg * pi/180
rho = hypot(xi, eta);  c = atan(rho)
if rho == 0: (ra, dec) = (crval1, crval2)
dec = asin( cos c * sin(dec_c) + eta * sin c * cos(dec_c) / rho )
ra  = ra_c + atan2( xi * sin c, rho * cos(dec_c) * cos c - eta * sin(dec_c) * sin c )
ra  = ra mod 360
```

- `propagate(source, mjd)`: `Δt = year(mjd) - ref_year`, `year(mjd) = 2000.0 + (mjd - 51544.5) / 365.25`, `ra = ra0 + (pmra / 3.6e6) * Δt / cos(dec0)`, `dec = dec0 + (pmdec / 3.6e6) * Δt`; zero motion when a proper motion is `null` (`DC §3.1`). For a Gaia source `ref_year = ref_epoch_year`; for the target `ref_year = target.coord_epoch_year`.

Frame target positions MUST be read from `frames[i].target_x / target_y`, never recomputed. Gaia primary predicted positions are read from `predicted_track[].x / y`. `worldToPixel` is used only for non-primary Gaia sources, for the target position of a coadd (propagate the target to `mjd_mean`, as `DC §7.3` item 5 does), and for cursor readouts.

### 9.4 `FrameCanvas` viewport

One shared component renders every image tool.

| Aspect | Rule |
|---|---|
| Layers | Bottom: image (offscreen `W x H` canvas, nearest-neighbour). Middle: overlays (vector, redrawn per frame). Top: DOM tooltips and readout. |
| Smoothing | `imageSmoothingEnabled = false`. Pixels are visibly square (about 6.15 arcsec each). |
| Fit | Default scale `floor`-fits the container, then zoom 1x to 32x by wheel or pinch around the cursor; pan by drag. Zoom and pan are shared across all tools in a session and reset on dataset change. |
| DPR | Backing store sized by `devicePixelRatio`; transforms apply to the context, not CSS. |
| Orientation labels | A compass (N up, E left) and a scale bar computed from `6.15 arcsec/px` (`meta.grid.pixel_scale_arcsec`). |
| Readout | On hover: pixel `(x, y)` in binary convention (`y` from `H - 1 - row`), RA/Dec from `pixelToWorld`, intensity with unit `MJy/sr`, sigma, and (diff tool) significance. `NaN` shows "masked". |
| Masked pixels | Drawn with the mask colour `#2b2f3a` with a 45-degree hatch at zoom >= 8x, never as black, so masked is distinguishable from low signal. |
| Export | "Save PNG" exports the current canvas composite (image plus overlays) at device resolution. |

### 9.5 Stretch (asinh)

Stretch parameters come from `meta.previews.stretch` (`type = "asinh"`, `lower_percentile = 1.0`, `upper_percentile = 99.5`); the client reads them rather than hard-coding.

For a set of finite values `S`:

```
lo = percentile(S, lower_percentile)       // linear interpolation between order statistics
hi = percentile(S, upper_percentile)
t  = clamp((v - lo) / (hi - lo), 0, 1)
s  = asinh(t / a) / asinh(1 / a)           // a = ASINH_SOFTENING (section 16), fixed for all targets
out8 = round(255 * s)
```

- `a` is a single constant shared by all tools and all targets so colours are comparable across targets.
- If `hi <= lo` (empty or flat data), `s = 0` for every pixel.
- `NaN` inputs never enter `S` and are rendered with the mask colour.
- Percentile computation uses a copy sorted ascending (typed array `sort`), `O(HW log HW)`; for `H, W <= 118` this is below 1 ms.
- **Limit scope.** Blink uses limits computed over the union of finite plane-0 values of every frame in the current blink set (not per frame) so brightness does not flicker. Difference significance and RGB use the scopes defined in sections 11 and 12.
- Intensities are in `MJy/sr` (`DC §1`) and are never rescaled before display.

---

## 10. Tool: Blink

Blink steps through images of one detector and one wavelength window, so brightness changes reflect time, not a different part of the spectrum (architecture §1 A).

### 10.1 Modes

| Mode | Items | Source |
|---|---|---|
| `frames` (default) | Frames of detector `d` whose wavelength lies in the window (10.2), ordered as in `frames.json` (`mjd`, `detector`, `frame_key`) | `frames.bin` item `frames[i].index` |
| `epochs` | One `epoch_detector` coadd per epoch for detector `d`, ordered by `epoch_id` | `coadds.bin` item `coadds[j].index` (`DC §7.1`) |

In `epochs` mode the wavelength window does not apply; each item shows `lambda_min_um` to `lambda_max_um` of the coadd, with the note "Coadd of N frames spanning this wavelength range".

### 10.2 Selection controls

| Control | Rule |
|---|---|
| Detector picker | Buttons D1 to D6. Only detectors present in `epochs[*].detectors` (`DC §6.1`) are enabled; others show a tooltip "No frames". Default: the detector with the most frames; ties resolve to the lower number. |
| Wavelength window | Centre `lambda0_um` and half-width factor `k` (default `1.0`, range `0.25` to `3`). A frame of detector `d` is in the window when `|lambda_um - lambda0_um| <= k * bandwidth_um` (frame's own `bandwidth_um`). Default `lambda0_um`: the `lambda_um` of detector `d` frames that has the largest in-window count; ties resolve to the lower wavelength. The control shows a histogram of `lambda_um` for the detector with the window drawn on it, and the in-window count. |
| Contamination filter | Max `contamination_level` to include (`0`, `1`, `2`; default `2`, i.e. all). `DC §3.6`. |
| Release filter | Checkboxes over `meta.observations.releases`. |
| Sliding-window coadd | Window `w` days (`0` = off, default; range `0` to `120`, step `1`). |
| Overlays | Toggles: predicted position, apertures (radii `3, 4, 5` px from `sed.aperture_radii_px`), annulus (`sed.annulus_px`), centroid, Gaia track. |
| Playback | FPS `1` to `10` (default `2`), loop, step buttons. |

An empty item set shows an empty state with the two closest actions (widen the window, change detector).

### 10.3 Frame rendering

For the current item:

1. Obtain plane 0 (binary order) via `getPlane` (section 6.3).
2. If sliding-window coadd is on (`w > 0`), replace it by the windowed coadd (10.4).
3. Compute limits over the whole blink set (section 9.5, limit scope), cached per `(set key, w)`.
4. `toCanvasOrder`, asinh stretch, write `ImageData` (grayscale; mask colour for `NaN`), draw.

Caption (always visible): `obs_time_utc`, `mjd`, `detector`, `lambda_um` with `bandwidth_um`, `release`, `processing_version` (or "n/a"), `epoch_id`, `good_fraction` as percent, `contamination_level` chip, `alignment_residual_px` (or "unknown"), `saturated_pixels` when greater than `0`.

### 10.4 Sliding-window coadd (client side)

For the current frame at time `t` and window `w > 0`, members are the frames of the current set with `|mjd - t| <= w / 2`. For each pixel, over members with finite intensity and sigma `> 0`:

```
wk = 1 / sigma_k^2
I_bar = sum(wk * I_k) / sum(wk)
V_bar = 1 / sum(wk)
```

The pixel is `NaN` when no member qualifies. The caption adds "Window coadd of N frames". Weights treat sigma as plane 1 of `frames.bin` (`DC §10.1`), never as variance. Results are cached per `(frame index, w)`.

### 10.5 Overlays

| Overlay | Position | Notes |
|---|---|---|
| Predicted position | `frames[i].target_x, target_y` | Cross-hair, label "predicted". Present for every frame, so a mover's expected track is visible across the blink. |
| Apertures / annulus | Same centre as predicted position | Circles of radius `3, 4, 5` px; annulus `6` to `10` px, dashed. |
| Centroid | `sed.points[i].centroid_x, centroid_y` | Cross with a circle of radius `centroid_err_px`. Omitted when any of the three is `null`. |
| Gaia primary | `gaia.sources[primary].predicted_track[]` entry whose `epoch_id` equals the item's epoch | Diamond marker, label "Gaia (predicted)". Only when `predicted_track` is non-null. |
| Trail | Optional: all epochs' predicted positions of the target as faint dots | Helps see motion that is below one pixel. |

### 10.6 Time slider

`TimeSlider` has one tick per item.

| Aspect | Rule |
|---|---|
| Spacing | "By frame" (equal spacing, default) with epoch separators and epoch labels; "By time" (linear in `mjd`). Because the cadence is clumpy (architecture §1), the default is by frame. |
| Tick colour | `contamination_level`: `0` neutral, `1` amber, `2` red. Colour is never the only cue: level `1` has a half-height tick, level `2` a full-height tick with a cap. |
| Tooltip | Date, `lambda_um`, contamination level, and the non-zero entries of `flag_fractions` sorted descending (`TRANSIENT 12%`, ...). `flag_fractions == null` shows "No aperture pixels". |
| Epoch strip | Colour band per epoch (palette of section 15.3) under the ticks. |
| Keyboard | Left/Right step, Home/End jump, Space play/pause, `[` and `]` change FPS. |
| Reduced motion | When `prefers-reduced-motion: reduce`, playback does not autostart and defaults to 1 FPS. |

---

## 11. Tool: Difference imaging

Two clearly named modes. Mode names in the UI: "Temporal difference (movers, variables)" and "Spectral difference (colour excess)".

### 11.1 Operands

Operand A and operand B are each either a frame (`frames.bin`) or a coadd (`coadds.bin`). Plane 0 is intensity `I` and plane 1 is its sigma, both `MJy/sr`.

| Mode | Pairing constraint (enforced by the pickers; violation disables Apply) |
|---|---|
| Temporal | Same detector; different epoch. Frame operands: `|lambda_A - lambda_B| <= bandwidth_A` (matched wavelength). Coadd operands: both `epoch_detector`, same `detector`, different `epoch_id`. |
| Spectral | Similar time: frame operands share `epoch_id`; coadd operands are two `epoch_detector` coadds with the same `epoch_id`, or two `detector` scope coadds (shown with the note "static-sky only, motion smears"). Wavelengths differ: `|lambda_A - lambda_B| > bandwidth_A`. |

Default pair: temporal mode picks the first and last epoch coadd of the active detector; spectral mode picks the two detectors with the highest `snr_target` among `detector` scope coadds.

### 11.2 Mathematics

For each pixel `p`, with `NaN` propagating:

```
D(p)       = I_A(p) - I_B(p)
sigma_D(p) = sqrt(sigma_A(p)^2 + sigma_B(p)^2)
S(p)       = D(p) / sigma_D(p)
```

A pixel is `NaN` when either input pixel is `NaN` or `sigma_D <= 0`. This follows `sigma_D^2 = V_A + V_B` of the architecture with plane 1 being sigma, so variances are `sigma^2`.

### 11.3 Display

| Layer | Rule |
|---|---|
| `S` map (default) | Linear diverging map over `[-S_CLIP, +S_CLIP]` (`S_CLIP = 5`), values clamped. |
| `D` map | Signed asinh: `L = percentile(|D|, upper_percentile)` over finite pixels; `u = clamp(D / L, -1, 1)`; `s = sign(u) * asinh(|u| / a) / asinh(1 / a)`; map `s in [-1, 1]` through the diverging map. |
| Colour map | Colour-blind-safe diverging (blue to neutral to orange). Neutral at `0`. Mask colour as in section 9.4. |
| Contours | Marching squares (`core/contour.ts`) on the `S` grid at `S = +3` and `S = -3`, evaluated on pixel centres; cells with any `NaN` corner are skipped. Positive contour solid, negative dashed. Toggle on by default. Contour vertices are in grid coordinates and are converted with section 9.2 (with the vertical flip). |
| Dipole hint | Legend text: "A mover appears as a positive/negative pair". |
| Overlays | Predicted position for A and for B (cross-hairs labelled A and B): frame operands use `frames[i].target_x/y`; coadd operands use the target propagated to `mjd_mean` and projected with `worldToPixel` (section 9.3). Gaia predicted-track points of the relevant epochs when present. |

### 11.4 Alignment trust indicator

WCS error of a fraction of a pixel produces false dipoles at bright stars. The tool always shows an "Alignment" badge:

```
rA, rB  = alignment_residual_px of each operand
r_pair  = sqrt(rA^2 + rB^2)
```

- Frame operand: its `alignment_residual_px`.
- Coadd operand: the maximum `alignment_residual_px` over its `frame_indices`; unknown if any member is `null`.
- Any `null` operand gives r_pair "unknown" (`DC §6.2`), rendered as a grey "Alignment unknown" badge.
- Otherwise badge states: `r_pair < ALIGN_GOOD_PX` good, `< ALIGN_POOR_PX` caution, else poor (constants in section 16). Poor and unknown add the line "Dipoles near bright stars may be alignment artefacts."

The badge shows the numeric value in pixels and in arcseconds (`r_pair * 6.15`).

### 11.5 Readout

Hover readout adds `D`, `sigma_D`, `S`. A summary strip lists the count of pixels with `|S| >= 3` and the maximum `|S|` within `3` px of the predicted position of A.

---

## 12. Tool: False-colour RGB (client-side compositor)

The compositor runs entirely in the browser from `coadds.bin`. No new network traffic occurs when presets or channel assignments change.

### 12.1 Inputs and combination

Each slot (`blue`, `green`, `red`) receives a set `K` of coadds. Combination is inverse-variance (`DC §7.1`), here on coadd planes (`sigma` is plane 1, so `V = sigma^2`):

```
for each pixel p, over k in K with finite I_k(p) and sigma_k(p) > 0:
  w_k = 1 / sigma_k(p)^2
  I_slot(p) = sum(w_k * I_k(p)) / sum(w_k)
  V_slot(p) = 1 / sum(w_k)
pixel is NaN when no k qualifies
```

Combining coadds this way is equivalent to coadding the underlying frames, so no frame-level data is needed. MJy/sr is a flux-density unit, so coadds of different channel widths are averaged directly; only weights carry noise.

### 12.2 Presets

| Preset | Slots | Source in `coadds.json` | Available when |
|---|---|---|---|
| Detector RGB | `blue`, `green`, `red` = the coadds with `scope == "detector"` whose `detector` is in `rgb_presets.detector_rgb.{blue,green,red}` | `rgb_presets.detector_rgb` | `detector_rgb != null` (equals `meta.previews.rgb_detector != null`, `DC §5.3` item 7) |
| Equal-channel RGB | `scope == "channel"` coadds whose `channel` is in `rgb_presets.equal_channel_rgb.{blue,green,red}_channels` | `rgb_presets.equal_channel_rgb` | always |
| Feature RGB | Up to three lines assigned to B, G, R; each slot is a continuum-subtracted line image | `rgb_presets.feature_lines` | at least one `channel` scope coadd for an `on_channel` |
| Custom | User-chosen detectors or channels per slot (12.5) | `coadds` | always |

Channels or detectors named by a preset but absent from `coadds` (no frames) are skipped silently. A slot with no members renders as zero and shows the chip "No data for this slot".

Detector RGB shows the group composition (for example "B: D1 D2, G: D3 D4, R: D5 D6"), the per-group SNR from `group_snr`, and `min_group_snr`. Blue is the lowest wavelength group.

### 12.3 Feature RGB

For a feature line `f` (`DC §7.3` item 8): let `on` be the `channel` scope coadd for `f.on_channel` and `C` the available `channel` scope coadds for `f.continuum_channels`.

```
I_cont(p) = inverse-variance mean of C            (12.1)
V_cont(p) = 1 / sum(w)                            (12.1)
I_line(p) = I_on(p) - I_cont(p)
V_line(p) = V_on(p) + V_cont(p)
```

`NaN` when `on` is missing or no continuum coadd qualifies at `p`. The slot value is `I_line` (it may be negative; limits clip at the lower percentile). Defaults: blue = Pa-alpha, green = Br-gamma, red = Br-alpha. Each slot shows the line name, `lambda_um`, `on_channel` and number of frames in the `on` coadd. A caution is shown when the `on` coadd has `n_frames < FEATURE_MIN_FRAMES` ("Few frames, noisy").

### 12.4 Stretch and compositing

1. Per slot, `toCanvasOrder` of `I_slot`.
2. Limits: per slot, `lo`, `hi` from the percentiles of `meta.previews.stretch` over the slot's finite pixels (default "Per-channel"); option "Linked" uses `lo = min(lo_slot)`, `hi = max(hi_slot)` over slots.
3. `s_slot = asinh(t / a) / asinh(1 / a)` with the shared `a` of section 9.5, times an optional slot gain `g` (default `1.0`, range `0.5` to `2.0`), clamped to `[0, 1]`.
4. Pixel `(R, G, B) = round(255 * (s_red, s_green, s_blue))`. A slot `NaN` pixel contributes `0`; a pixel `NaN` in all three slots is drawn with the mask colour.
5. Draw into the shared `FrameCanvas`; overlays as in 10.5 (predicted position at the grid position of the coadd `mjd_mean` is only shown for `epoch_detector` scope; for static-sky scopes show the target position at `meta.center` plus the note "Motion smears in multi-epoch coadds").

### 12.5 Custom assignment (`ChannelRgbEditor`)

- Basis "Detectors": a 6 x 3 checkbox grid. Each detector can belong to at most one slot.
- Basis "Channels": three range brushes on a `0..101` channel axis with the line markers drawn; channels `50` and `51` are hatched and excluded.
- A live readout lists, per slot, the number of member coadds and the combined `snr` estimate `sqrt(sum(snr_target^2))` over members (`null` or negative counts as `0`, matching `DC §7.3` item 6).

### 12.6 Instant look and fallback

On entering the tool the matching server PNG (`rgb_detector.png`, `rgb_equal_channel.png`, `DC §2`) is shown immediately, drawn **without** a vertical flip (PNG row `0` is north), labelled "Server preview". When the client result is ready it replaces the preview with a 150 ms cross-fade. If decoding fails, the server preview stays and the chip "Client compositor unavailable" appears. For `Feature` and `Custom` there is no preview; a skeleton is shown during the computation.

---

## 13. Tool: SED and lambda-time plane

Both views read only `sed.json` (`DC §8`) and `meta`. They replace any single-wavelength "light curve". Mandatory label on both: "Quick-look from L2 cutouts" and a short disclaimer "Not science-grade photometry". When `VITE_IRSA_SPECTROPHOTOMETRY_URL` is set, a "Open in IRSA Spectrophotometry Tool" button is shown (opens in a new tab with `rel="noopener"`).

### 13.1 Shared data shaping (`core/sed.ts`)

| Item | Rule |
|---|---|
| Aperture | Index `a` in `0..2` selecting `sed.aperture_radii_px[a]` (`3, 4, 5` px). Default `sed.primary_aperture_index` (`0`). |
| Point value | `flux_mjy[a]`, error `flux_err_mjy[a]`, unit `mJy`. If `flux_mjy[a] == null` the point is not drawn and is counted in "N frames without photometry". |
| Flagged | `flagged == true` draws a hollow marker (`DC §8.2` item 4). A "Hide flagged" toggle removes them. |
| Epoch colour | `epochColor[epoch_id]` from the palette of section 15.3, with a legend; epochs are toggled individually. |
| Detector filter | D1 to D6 toggles. |
| Provenance footer | `solid_angle_source`: `"sapm"` shows "per-detector solid-angle pixel map"; `"nominal_pixel"` shows "nominal pixel solid angle {nominal_pixel_sr} sr". Plus annulus `sed.annulus_px`. |

### 13.2 SED view

| Aspect | Rule |
|---|---|
| Axes | x = `lambda_um` (linear default, optional log), y = flux in `mJy` (linear default, optional signed asinh for wide dynamic range). x domain spans `min` to `max` of `meta.channels[*].lambda_um` padded by half a bandwidth. |
| Marker | One per point at `(lambda_um, flux)`; vertical error bar `+-flux_err_mjy[a]`; horizontal bar `+-bandwidth_um / 2`. |
| Epochs | Colour by epoch so variability appears as vertical scatter at fixed lambda. |
| Connecting lines | None. Points are never joined or interpolated. |
| Dichroic gap | Channels `50` and `51` (`meta.channels`) define a shaded, hatched band labelled "Dichroic gap (channels 50-51)" from `lambda_um - bandwidth_um / 2` of channel `50` to `lambda_um + bandwidth_um / 2` of channel `51`; where `bandwidth_um` is `null`, the boundary is the midpoint to the adjacent channel. No point can sit inside it. The band is drawn as a gap, never bridged. |
| Line markers | `meta.processing.line_markers` (8 entries, `DC §5.2`): vertical dashed lines with labels; display names come from `copy.ts` (`Pa-beta` shown as "Paβ", `H-minus` as "H⁻", `Pa-alpha` "Paα", `Br-gamma` "Brγ", `Br-beta` "Brβ", `PAH-3.3` "PAH 3.3", `Br-alpha` "Brα", `CO` "CO"). Labels are staggered vertically to avoid overlap. Tooltip shows name and `lambda_um`. Toggle on by default. |
| Hover | Tooltip: `obs_time_utc`, `epoch_id`, detector, `lambda_um`, `bandwidth_um`, flux with error (`mJy`), contamination level of the frame, `flagged`. |
| Click | Opens the frame in Blink: sets `detector`, `lambda0_um = lambda_um`, selects the frame index, `tool=blink`. |
| Epoch slice | Selecting one epoch in the legend shows only its points ("SED at epoch"). |

### 13.3 Lambda-time plane

x = time, y = wavelength, colour = flux. A light curve is a horizontal slice at fixed lambda; an SED is a vertical slice at one epoch.

| Aspect | Rule |
|---|---|
| Cell | One rectangle per drawable point. Centre `(x(mjd), lambda_um)`; height `bandwidth_um` (at least `LT_MIN_CELL_PX` px); width `LT_CELL_WIDTH_PX` px, fixed in screen space. |
| Time axis default ("Compressed") | Epochs are laid out left to right in `epoch_id` order. Epoch `e` occupies a segment whose length is proportional to `max(mjd_end - mjd_start, EPOCH_MIN_SPAN_DAYS)` (from `frames.epochs`), segments separated by a fixed gap of `EPOCH_GAP_PX` px marked with a break symbol. Within a segment `x = segStart + (mjd - mjd_start) * scale`. Ticks are labelled with each epoch's start date (UTC). This keeps the clumpy cadence readable. |
| Time axis "True time" | Linear in `mjd` with date ticks; epoch bands shaded. |
| Colour | Sequential colour-blind-safe map. Values stretched like section 9.5 applied to the finite `flux_mjy[a]` values (percentiles from `meta.previews.stretch`, shared `a`). Colour bar with `mJy` ticks. Flagged points have a dark outline. |
| Dichroic gap | Same hatched band as 13.2 along the y axis. |
| Line markers | Horizontal dashed lines across the plane at each `lambda_um`. |
| Light-curve strip | Brush a horizontal band `[lambda0 - k * bw, lambda0 + k * bw]` (same `k` semantics as Blink). Below the plane, plot flux versus `mjd` (compressed or true axis, same as above) for points in the band, error bars, coloured by detector, with the note "Only comparable within one detector and wavelength window". |
| SED strip | Click an epoch header: shows the SED view (13.2) for that epoch beside the plane. |
| Click | Same as 13.2 (opens Blink). |
| Export | "Download CSV" of the visible points with columns `frame_index, epoch_id, detector, channel, mjd, obs_time_utc, lambda_um, bandwidth_um, flux_mjy, flux_err_mjy, flagged` for the selected aperture. |

Performance: up to about 500 points per target; SVG is used for axes and annotations, Canvas 2D for cells and markers, redrawn on pointer-driven changes with `requestAnimationFrame` coalescing. Hit-testing uses a linear scan (n is small).

---

## 14. Tool: Gaia check

The panel presents `gaia.json` (`DC §9`) and the proper-motion consistency test. It is reachable as `tool=gaia` and as a docked summary in Blink and Diff.

### 14.1 Verdict

`gaia.verdict` is rendered verbatim by enum; the sentence in `verdict_detail` is displayed unchanged below the headline.

| `verdict` | Headline (`copy.ts`) | Icon / colour |
|---|---|---|
| `match_consistent` | "Gaia match, motion consistent" | check, green |
| `match_inconsistent` | "Gaia match, motion inconsistent: possible blend or variability" | warning triangle, amber |
| `no_counterpart` | "No Gaia counterpart" | star outline, blue (highlighted as the interesting case) |
| `unavailable` | "Gaia query unavailable" | dash, grey |

The client MUST NOT recompute the verdict. A `gaia_unavailable` job warning (section 7.6) is consistent with `unavailable`; the panel shows only the verdict, an explanation ("Gaia could not be queried; SPHEREx data are unaffected"), and hides the sources table, measured motion and map overlay.

Slug-specific context lines (a static table in `copy.ts`, shown as an info note under the verdict when the slug matches):

| Slug | Note |
|---|---|
| `eps-indi-b` | "A close brown-dwarf pair: the components are blended at 6.15 arcsec per pixel. This is expected, not a tool failure." |
| `wise-0855` | "Extremely red and optically faint; an absent Gaia counterpart is plausible." |

### 14.2 Content blocks

| Block | Content |
|---|---|
| Header | Verdict headline, `verdict_detail`, `match_radius_arcsec` (`10`), `n_sources_in_cone`. |
| Target proper motion | `meta.target.pm_source` (`gaia_dr3`, `literature`, `user`, `none`) with `pm_reference`, and the values `pmra_mas_yr`, `pmdec_mas_yr`, `parallax_mas` (or "none"). If `coord_epoch_assumed` is `true`, the note "Epoch not supplied, assumed J2000". |
| Measured motion | When `measured_pm != null`: `pmra_mas_yr +- pmra_err_mas_yr`, `pmdec_mas_yr +- pmdec_err_mas_yr`, `n_frames_used`, `n_epochs_used`, `baseline_days`, `method`. When `null`: "Not enough epochs or baseline for a motion fit (needs at least 3 epochs over 300 days)", values read from `meta.processing.pm_fit_min_epochs` and `pm_fit_min_baseline_days`. |
| Comparison | When `consistency != null`: a small SVG vector plot in the (`pmra`, `pmdec`) plane showing Gaia and measured points with error bars, the difference vector, and text `delta_pmra`, `delta_pmdec`, `sigma_combined_mas_yr`, and "Within 3 sigma: yes/no" from `within_3_sigma`. When `null`: no plot, and the reason line (measured motion missing, or the primary has no proper motion). |
| Sources table | Sorted as delivered (by `separation_arcsec`). Columns: `source_id` (string, copyable), `phot_g_mean_mag`, `parallax_mas`, `pmra_mas_yr`, `pmdec_mas_yr`, `separation_arcsec`, primary marker. `null` shows "n/a". Row click centres the map and canvas on that source. |
| Query details | Collapsible: `executed_utc`, `radius_arcsec`, `table`, `endpoint`, and the `adql` text in a monospace block with a copy button. |

### 14.3 Re-run with proper motion

A "Re-run with proper motion" action opens the position form (section 8.2) prefilled from `meta.target`: `input_ra_deg`, `input_dec_deg`, `name`, `meta.grid.size_deg`, and `coord_epoch_year` only when `coord_epoch_assumed == false`. The user may type `pmra_mas_yr` and `pmdec_mas_yr` (both or neither, section 7.1). Submit creates a new job; the result is a different `slug` (`DC §11.3`), and the current dataset stays untouched.

---

## 15. UX states, accessibility and design

### 15.1 Layout

| Viewport | Layout |
|---|---|
| >= 1024 px | Map left, lab sidebar right (width 45 percent, resizable 30 to 60 percent). |
| < 1024 px | Map full screen; lab is a bottom sheet with three snap points (peek, half, full). |
| `embed=1` | As section 5.4. |

Header: title (`meta.title`), `tier` chip, `status` chip (`partial` highlighted), data version short hash (first 8 hex of `data_version`), target picker. Footer (not in embed): glossary link.

### 15.2 States

Every data-dependent view has all of: loading (skeleton), empty (clear message plus action), error (message from `copy.ts` plus action), ready.

| Situation | UI |
|---|---|
| Dataset loading | Skeleton plus step list (meta, files, verification). |
| Integrity failure | Error with file name and "expected vs received" in an expandable block; Retry button. |
| Job queued / running | `JobProgress` (section 7.3). |
| No coverage / upstream / timeout | Section 7.6. |
| Partial dataset | Persistent banner (section 6.1). |
| Zero items for a tool | Empty states per tool (for example "No frames for detector D3 in this window"). |
| Offline | A toast "You are offline"; static datasets already loaded keep working. |

A glossary popover (`copy.ts`) defines LVF (linear variable filter), epoch, detector and band, channel, contamination level, flags, dichroic, MJy/sr, mJy, asinh stretch. Contamination and flag terms link to the bad-flag names of `DC §3.4`.

### 15.3 Design tokens and palettes

- Dark theme default; light theme supported through Tailwind `dark:` classes and a toggle persisted in `localStorage` (wrapped in `try/catch`).
- Epoch palette (colour-blind safe, Okabe-Ito order): `#E69F00, #56B4E9, #009E73, #F0E442, #0072B2, #D55E00, #CC79A7, #999999`; epoch `e` uses index `e mod 8`; beyond 8 epochs, a different marker shape every 8 (circle, square, triangle, diamond).
- Contamination: neutral `#9AA4B2`, amber `#F5A524`, red `#E5484D`, always paired with the tick/icon shape cues of section 10.6.
- Verdict colours as in 14.1, always with icons.
- Diverging map (difference): `#2B6CB0` to neutral `#E5E7EB` to `#DD6B20`. Sequential map (lambda-time): a perceptually uniform, colour-blind-safe map (viridis-like), 256-entry LUT generated once.
- Mask colour `#2B2F3A`.
- Typography: system UI stack for text, monospace for numbers and IDs, tabular figures in tables and readouts.

### 15.4 Accessibility

- All controls are keyboard operable with visible focus rings; tool tabs follow the ARIA tabs pattern; sliders are `role="slider"` with `aria-valuetext` (date and wavelength).
- Canvases have an `aria-label` describing the content and a sibling visually-hidden live region announcing the current item caption on change.
- Colour is never the only carrier of information (section 15.3).
- Minimum contrast 4.5:1 for text, 3:1 for graphical objects.
- Honour `prefers-reduced-motion` (section 10.6) and `prefers-color-scheme` for the initial theme.
- Tooltips are reachable by focus, not only hover.

### 15.5 Performance budgets

| Item | Budget |
|---|---|
| Initial JS (gzip) excluding Aladin | <= 250 KB |
| Aladin Lite | Lazy-loaded chunk; map visible before the lab loads |
| Lab tools | Route-level lazy chunks per tool |
| Static dataset ready (about 3.6 MB at 500 frames of 60x60) | < 2 s on a 20 Mbit/s link (cached: < 300 ms) |
| Blink step render | < 16 ms per frame at `H, W <= 118` |
| RGB recompute on assignment change | < 100 ms at `H, W <= 118` |

Heavy loops (percentiles, coadds, marching squares) run on the main thread in v1; if any budget is missed, they move to a module Web Worker with transferable `Float32Array`s without changing `core/` signatures.

### 15.6 Error handling and logging

- Network and parse failures never leave the UI blank; the nearest error boundary renders a recovery card with Reload and "Go to Tier 1 targets".
- Logging is `console` only, with a `[sse]`, `[data]`, `[map]` prefix; no telemetry is sent.

---

## 16. Constants (`config/constants.ts`)

| Name | Value | Used in |
|---|---|---|
| `ASINH_SOFTENING` (`a`) | `0.1` | 9.5, 11.3, 12.4, 13.3 |
| `S_CLIP` | `5` | 11.3 |
| `SIGNIFICANCE_CONTOUR` | `3` | 11.3 |
| `ALIGN_GOOD_PX` | `0.3` | 11.4 |
| `ALIGN_POOR_PX` | `0.5` | 11.4 |
| `FEATURE_MIN_FRAMES` | `3` | 12.3 |
| `DECODE_CACHE_ITEMS` | `64` | 6.3 |
| `STREAM_PREVIEW_MAX` | `48` | 7.4 |
| `SSE_MAX_RECONNECTS` | `8` | 7.2 |
| `SSE_STALL_MS` | `45000` | 7.2 |
| `JOB_SLOW_MS` | `60000` | 7.5 |
| `URL_DEBOUNCE_MS` | `250` | 5.3 |
| `EPOCH_MIN_SPAN_DAYS` | `1` | 13.3 |
| `EPOCH_GAP_PX` | `24` | 13.3 |
| `LT_CELL_WIDTH_PX` | `6` | 13.3 |
| `LT_MIN_CELL_PX` | `3` | 13.3 |
| `ZOOM_MIN` / `ZOOM_MAX` | `1` / `32` | 9.4 |
| `FOV_MIN_DEG` / `FOV_MAX_DEG` | `0.01` / `180` | 5.1 |

These are frontend presentation constants only. Grid scale, flags, radii, annulus, epoch gap, bad mask and similar processing values are always read from `meta`, never hard-coded.

---

## 17. Testing and acceptance

### 17.1 Unit tests (Vitest)

| Area | Required cases |
|---|---|
| `half.ts` | The 16-byte vector of `DC §10.3` decodes to `[1, -1, NaN, 65504, -65504, 0, 0.5, 2]`; subnormals; all-ones exponent with non-zero mantissa is `NaN`. |
| `binary.ts` | Offset formula of `DC §10.1` against a hand-built buffer; byte-length mismatch rejects; `toCanvasOrder` flip tests of section 9.1. |
| `wcs.ts` | `worldToPixel` of the grid centre equals `(W/2 - 0.5, H/2 - 0.5)`; round trip `pixelToWorld(worldToPixel(p))` within `1e-9` deg; `propagate` with `null` proper motion is the identity; sign of RA increase toward lower `x`. |
| `stretch.ts` | Percentile interpolation; `hi <= lo` yields zeros; `asinh` endpoints `0` and `1`. |
| `blink.ts` | Window membership and default `lambda0`; sliding coadd weights; empty set. |
| `diff.ts` | `NaN` propagation; `sigma_D`; `r_pair` with `null`; contour on a synthetic dipole. |
| `rgb.ts` | Inverse-variance combination against a hand-computed case; missing coadds skipped; feature subtraction variance. |
| `sed.ts` | Null photometry excluded; dichroic band bounds; compressed time axis monotonic. |
| `urlSync.ts` | Parse/serialize round trip, clamping, wrap of `ra`, unknown params preserved, no write loop. |
| `sse.ts` | Parser with split chunks, comments, `retry`, duplicate ids, `Last-Event-ID` on reconnect, no reconnect after `complete` or `failed`. |
| `loader.ts` | Integrity failures: wrong `bytes`, wrong `sha256`, mismatched `data_version`, major version mismatch. |

### 17.2 E2E (Playwright, against a fixture dataset and a mock job server)

1. Load `?slug=barnards-star&tool=blink`: dataset ready, blink steps, URL keeps `ra/dec/fov/tool`.
2. Browser back/forward restores `tool` and view without a write loop.
3. Gaia overlay visible on the map and as a predicted-position marker in the lab.
4. Difference tool: temporal pair, contours present, alignment badge shown, unknown residual shows the grey badge.
5. RGB: Detector RGB shows the server preview then the client composite; `rgb_detector == null` disables the preset.
6. SED: hollow flagged markers, dichroic band drawn, no connecting lines, line markers toggle.
7. Tier 2: POST `202`, SSE progress to complete, static load, `failed(no_coverage)` state, `429` with `Retry-After`, mid-stream disconnect resumes with `Last-Event-ID`.
8. Integrity failure fixture: tampered `frames.bin` is rejected.
9. `embed=1` hides chrome.
10. Gate G1: with the flag `false` the Cube control is absent; with the flag `true` and a failing probe it stays absent.

### 17.3 Conformance checklist

The frontend conforms to this spec when:

1. Every file read passes the checks of section 6.1 and no unknown-version dataset is displayed.
2. All binary-to-canvas conversions go through `toCanvasOrder` and PNG previews are never flipped.
3. Blink never mixes detectors and never mixes wavelengths outside the selected window (frames mode).
4. Difference and RGB follow the formulas of sections 11 and 12 with sigma (plane 1) squared into variance.
5. The Gaia verdict and all `null` states are displayed exactly as supplied by `gaia.json`.
6. The URL contains and restores `ra`, `dec`, `fov` and `tool`.
7. No code path contacts a host other than the application origin (plus the Aladin survey host configured through `VITE_HIPS_SURVEY_BASE`).

---

## 18. Implementation order

Build in the order below. Each step lists the spec sections it implements, what it depends on, and when it is done. Hours follow the frontend (F) column of the architecture roadmap. A step is not started until the steps it depends on are done, except where marked parallel.

### 18.1 Rules

1. The Tier 1 demo path (Barnard's Star, static load, Blink, Gaia check) is built first and never broken afterwards.
2. Work against a **fixture dataset** until the backend's export v0 exists. The fixture is a small `/data/fixture-barnard/` directory that validates against `DATA_CONTRACT.md` (synthetic 30x30 grid, 2 detectors, 3 epochs, one moving bright pixel). Switch to real Tier 1 data as soon as it is published.
3. Unit tests during the MVP phase cover only `half.ts`, `binary.ts` (offset formula and `toCanvasOrder`), `wcs.ts` and `contract/validate.ts`. The rest of section 17 is deferred to step F14.
4. Every step ends with a working `main` branch. No half-merged tools.

### 18.2 Steps

| Step | Hr | Scope | Spec | Depends on | Done when |
|---|---|---|---|---|---|
| F0 | 0 | Repo scaffold: Vite, React, TS strict, Tailwind, ESLint, Vitest. `config/env.ts`, `config/constants.ts`, empty `copy.ts`. Dev proxy for `/api`, `/data`. | 2, 3, 16 | none | `npm run dev` serves a blank app; `npm test` runs. |
| F1 | 0-1 | `aladinAdapter.ts` hello world (init, goto, fov, events). **Gate G1 spike:** try the SPHEREx HiPS cube in a throwaway branch, record the result, set the default of `VITE_FEATURE_G1_CUBE`. | 8.1, 8.4 | F0 | Map renders and reports view changes; G1 decision written in the repo README. |
| F2 | 1-2 | `contract/types.ts` generated from the contract schemas; `contract/validate.ts`. Fixture dataset committed. | 4.1, 6.1 (steps 1, 5) | F0 | Fixture `meta.json` passes `validate.ts`; wrong major version is rejected (unit test). |
| F3 | 2-3 | `core/half.ts`, `core/binary.ts` (`elementIndex`, `getPlane`, `toCanvasOrder`), `core/hash.ts`. | 6.3, 9.1 | F2 | `DC §10.3` vector and the flip tests of 9.1 pass. |
| F4 | 3 | `data/loader.ts`, `data/dataset.ts`, `data/registry.ts`: full static load with byte, SHA-256 and cross-file checks; derived indexes. | 4.1, 6.1, 6.2 | F2, F3 | Fixture loads to `ready`; a tampered `.bin` ends in `error` with `integrity_failed`. |
| F5 | 3 | `state/store.ts`, Lab shell (`Lab.tsx`, tool tabs), layout split map / lab, design tokens. | 4.2, 15.1, 15.3 | F1, F4 | Map left, lab right; tabs switch; dataset title shown in header. |
| F6 | 4 | `core/wcs.ts` and `core/stretch.ts`. `FrameCanvas` with pan, zoom, DPR, compass, scale bar, readout, mask colour. Renders plane 0 of one item. | 9.2-9.5 | F3, F5 | Fixture's bright pixel appears in the correct (north-up, east-left) position; readout matches `pixelToWorld`; `wcs` tests pass. |
| F7 | 5 | **Blink:** detector picker, wavelength window, playback, set-wide limits, overlays (predicted, apertures, centroid). `TimeSlider` with epoch strip. | 10.1-10.3, 10.5, 10.6 (without flag colours) | F6 | Blink steps through one detector in one wavelength window on real Barnard data; predicted cross-hair moves epoch to epoch. |
| F8 | 6 | Gaia: map overlay (sources, primary, predicted track) and `GaiaPanel` (verdict, measured motion, comparison, sources table, query details). Gaia diamond in Blink. | 8.3, 10.5, 14 | F7 | All four verdict states render from fixtures; `source_id` stays a string. |
| F9 | 7 | `core/sed.ts`; SED view and lambda-time plane with dichroic gap, line markers, epoch colours, hollow flagged markers, light-curve strip, click-through to Blink. | 13 | F5 | SED and lambda-time render from `sed.json`; no point is joined across the dichroic gap. |
| F10 | 8 | `state/urlSync.ts` (parse, clamp, serialize, push/replace, popstate, loop guard), boot sequence, embed mode. | 5 | F7 | `?slug=barnards-star&tool=blink` reloads to the same view; back/forward works; no write loop. |
| **M1** | 12 | **Barnard vertical slice:** registry, static load, map, Blink, Gaia, SED, URL. | | F4-F10 | Demo arc step 1 works end to end on the deployed dev build. |
| F11 | 9 | `core/rgb.ts`; RGB tool with Detector and Equal-channel presets, server preview then client composite, linked / per-channel limits. | 12.1, 12.2, 12.4, 12.6 | F6 | Detector RGB matches the server PNG orientation; `rgb_detector == null` disables the preset. |
| F12 | 10 | `core/diff.ts`, `core/contour.ts`; Diff tool with temporal and spectral modes, pickers enforcing pairing rules, `S` / `D` maps, contours, alignment badge. | 11 | F6 | Temporal diff of first vs last epoch shows a dipole on Barnard; unknown residual shows the grey badge. |
| F13 | 11 | Contamination tick colours and shape cues, flag tooltip, contamination and release filters, sliding-window coadd. | 10.2, 10.4, 10.6 | F7 | Ticks show levels 0/1/2 with colour and shape; window coadd caption shows N frames. |
| F14 | 13-15 | Fix M1 bugs; tooltips; glossary; RGB preset buttons; Feature RGB and custom assignment. Remaining unit tests of 17.1 only if time allows. | 12.3, 12.5, 15.2 | M1, F11 | Feature RGB renders Pa-alpha / Br-gamma / Br-alpha slots. |
| F15 | 16 | Tier 2 UI states: "Analyze this position" form with pre-validation, `data/jobs.ts`, `JobProgress` and `JobErrors` driven by mocked events. | 7.1, 7.3, 7.6, 8.2 | F10 | All response codes (`200`, `202`, `422`, `429`, `5xx`) and all `failed` codes render correct states against a mock. |
| F16 | 17-19 | Mobile bottom sheet, embed layout, diff and RGB polish, accessibility pass (keyboard, ARIA, contrast, reduced motion). | 5.4, 15.1, 15.4 | F12, F15 | Keyboard-only walk through every tool succeeds; layout works at 375 px. |
| F17 | 20 | `data/sse.ts` and `data/jobRunner.ts`: fetch-based SSE, parser, `Last-Event-ID` resume, watchdog, terminal handling. Wire to `JobProgress`. | 7.2, 7.3 | F15, backend SSE | A real job streams to `complete` and loads the dataset; a killed connection resumes without duplicate events. |
| F18 | 21 | Streamed frame previews, slow-job hint with Tier 1.5 alternatives, partial banner. | 7.4, 7.5, 6.1 | F17 | Thumbnails appear while frames stream; `partial` result shows the banner. |
| **M3** | 26 | **Random coordinate end to end:** click map, submit, progress, load, all tools. | | F17, F18 | Demo arc step 5 works on the deployed build. |
| F19 | 26-27 | Integration and bug bash with the backend. | | M3 | Bug list empty for P0 and P1. |
| F20 | 28 | **Feature freeze.** | | F19 | No new features after this point. |
| F21 | 29 | Performance and bundle: lazy chunks for Aladin and tools, budgets of 15.5. Move heavy loops to a Worker only if a budget fails. | 15.5 | F20 | Budgets met on a mid-range laptop. |
| F22 | 30-31 | Deploy; error boundaries and recovery cards; offline toast; fallback to Tier 1. | 15.2, 15.6 | F21 | Deployed build survives backend down: Tier 1 still works. |
| F23 | 32 | **Code freeze.** Final QA on the deployed build, rehearsal. | 17.3 | F22 | Conformance checklist 17.3 passes manually. |
| F24 | after M3 | Deferred test debt: rest of 17.1, Playwright suite of 17.2. | 17.1, 17.2 | F23 | Only after the hackathon unless time remains. |

Gate G1 (cube toggle) is built only if the F1 spike succeeded, and then as a parallel task anywhere between F11 and F16. If the spike failed, `cubeLayer.ts` is not written.

### 18.3 Cut order

If the schedule slips, cut from the frontend in this order and keep everything else:

1. Gate G1 cube toggle.
2. Feature RGB and custom RGB assignment (keep Detector and Equal-channel presets).
3. Sliding-window coadd in Blink.
4. Tier 2 RGB (keep Tier 2 Blink and SED).
5. Embed mode.
6. Streamed frame previews (keep the progress bar).

Never cut: static load with integrity checks, Blink, Gaia check, SED and lambda-time plane, URL sync, the Tier 1 demo path.
