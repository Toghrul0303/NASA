# Tier 2 preset bodies

Captured against a local `spherex serve` on 2026-11-15. The only POST that ran was the cached WISE 0855 body. The server log shows `POST /api/jobs` → 200 and no TAP request. A new (uncached) job was not submitted, because that calls IRSA.

Slug identity is `NormalizedRequest.slug` in `backend/src/spherex_backend/jobs.py`, reached through `validate_request` in `api.py`. The key is

```text
{ra:.6f}|{dec:.6f}|{size:.2f}|{repr(pmra) or none}|{repr(pmdec) or none}|{epoch:.2f}
```

and the slug is `c-` plus the first 16 hex characters of SHA-256 of that UTF-8 string. `coord_epoch_year` omitted becomes `2000.0`. `pmra_mas_yr: -8120` is stored as `-8120.0`; `repr` of that float is `-8120.0`.

## Preset bodies

| Preset | Slug | Demo |
|---|---|---|
| WISE 0855 coord | `c-a55d19970b4b8fd7` | safe for demo (directory exists, `status` `complete`, 120 frames, 3 epochs) |
| Proxima Centauri | `c-843ee254e3d6b9be` | may fail while IRSA is unstable (not on disk) |
| Epsilon Eridani | `c-c8a384476c0ae479` | may fail while IRSA is unstable (not on disk) |

Safe body. Both proper motions are required. The same RA and Dec without them is a different slug.

```json
{
  "ra_deg": 133.795129,
  "dec_deg": -7.245147,
  "size_deg": 0.1,
  "name": "WISE 0855 coord",
  "pmra_mas_yr": -8120,
  "pmdec_mas_yr": 679
}
```

```json
{
  "ra_deg": 217.42894,
  "dec_deg": -62.67949,
  "size_deg": 0.1,
  "name": "Proxima Centauri"
}
```

```json
{
  "ra_deg": 53.23268,
  "dec_deg": -9.45826,
  "size_deg": 0.1,
  "name": "Epsilon Eridani"
}
```

`backend/tests/unit/test_job_slug.py` locks these three bodies to those slugs. It does not use the network.

## Cached job (HTTP 200)

`POST /api/jobs` with the WISE body. `created_utc` is the `meta.json` timestamp. `elapsed_s` on the synthesized `complete` event is `0.0` because `meta.json` does not store the original duration.

```json
{
  "job_id": "j_0ef172fd2b181ffe",
  "slug": "c-a55d19970b4b8fd7",
  "status": "complete",
  "cached": true,
  "joined": false,
  "created_utc": "2026-11-14T16:41:38.156Z",
  "events_url": "/api/jobs/j_0ef172fd2b181ffe/events",
  "data_base_url": "/data/c-a55d19970b4b8fd7/",
  "request": {
    "ra_deg": 133.795129,
    "dec_deg": -7.245147,
    "size_deg": 0.1,
    "name": "WISE 0855 coord",
    "pmra_mas_yr": -8120.0,
    "pmdec_mas_yr": 679.0,
    "coord_epoch_year": 2000.0,
    "coord_epoch_assumed": true,
    "force_refresh": false
  }
}
```

`job_id` is whatever record is current for that directory. A later rebuild mints a new one. The slug does not change.

## Cached SSE stream

`GET /api/jobs/j_0ef172fd2b181ffe/events` returned `200`, `content-type: text/event-stream; charset=utf-8`, `cache-control: no-cache`, `x-accel-buffering: no`. The stream then closed. There is no `queued` or `running` event on a synthesized cache hit.

```text
retry: 3000

id: 1
event: job_state
data: {"job_id":"j_0ef172fd2b181ffe","status":"complete","queue_position":null,"timestamp_utc":"2026-11-14T16:41:46.593Z"}

id: 2
event: complete
data: {"job_id":"j_0ef172fd2b181ffe","slug":"c-a55d19970b4b8fd7","result_status":"complete","data_base_url":"/data/c-a55d19970b4b8fd7/","data_version":"sha256:5a14e22f2f65ef09fc33e19b45e7be2f7296dd7eb202d951472580ea2f4d9fd7","n_frames":120,"n_epochs":3,"n_failed_fetches":0,"files":{"frames.json":{"bytes":133908,"sha256":"3cc85c2bf191bb262cd140ad6b1b269cf94f3105e4f304e227a9c4247ef45985"},"frames.bin":{"bytes":1728000,"sha256":"519d4739311a1784b113075a2b328b552af20565e85d35861ae0b1065d22d68b"},"coadds.json":{"bytes":35730,"sha256":"dc3651befd4d269cf7621cca217d3a0570828e73ad189b5b6b4ec03436dd742b"},"coadds.bin":{"bytes":1526400,"sha256":"6e1c319c0db48030669d50340ff7edfd0ee6d55a6cb2c7c93a6fab355245ec51"},"sed.json":{"bytes":54151,"sha256":"e21317715a1a9dc619c8acb97b95cc029d9af554895302f04cfe3a94d966f967"},"gaia.json":{"bytes":19865,"sha256":"1c22cba28c1467c27508c6da35090a3600c2d9309e1ac641a35e71b6bc4e0300"},"meta.json":{"bytes":11326,"sha256":"938c17f3f826b2ae0a69db62dd3255784bbbed44566d9492f390dc9c6d46eecf"}},"elapsed_s":0.0}
```

`Last-Event-ID: 1` replayed only `id: 2` (`event: complete`), after the same `retry: 3000` line. Ids start at 1. Events with `id` greater than the header are replayed, then the stream closes because the log is terminal.

A live job that is not cached emits, in order, `job_state` (`queued`), `job_state` (`running`), `stage`, `discovery`, `progress`, `frame`, `warning`, and then `complete` or `failed`. That sequence was not captured here.

## Invalid body (HTTP 422)

`POST /api/jobs` with `{"ra_deg":1,"dec_deg":2,"size_deg":0.3}`.

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Request validation failed.",
    "details": [{ "field": "size_deg", "issue": "must be one of 0.05, 0.1, 0.2" }]
  }
}
```

## Unknown slug (HTTP 404)

`POST /api/jobs` does not take a slug. A slug with no `meta.json` is a data-route miss. `GET /data/c-not-on-disk/meta.json`:

```json
{"error":{"code":"not_found","message":"Not found.","details":[]}}
```

An unknown `job_id` on `GET /api/jobs/{job_id}` or the events route uses the same envelope (`message` `Unknown job.` on those two routes).

## Failed job (fixture, no IRSA)

`cache/jobs/j_fixtfa11ed000001/` was written by hand with `status` `failed` and a two-event log. `GET /api/jobs/j_fixtfa11ed000001` returned 200. `status` is `failed`, which is outside the §11.4 enum (`queued`, `running`, `complete`). `cached` is false.

```json
{
  "job_id": "j_fixtfa11ed000001",
  "slug": "c-fixturefailed01",
  "status": "failed",
  "cached": false,
  "joined": false,
  "created_utc": "2026-11-15T06:00:00.000Z",
  "events_url": "/api/jobs/j_fixtfa11ed000001/events",
  "data_base_url": "/data/c-fixturefailed01/",
  "request": {
    "ra_deg": 1.0,
    "dec_deg": 1.0,
    "size_deg": 0.1,
    "name": "fixture failed",
    "pmra_mas_yr": null,
    "pmdec_mas_yr": null,
    "coord_epoch_year": 2000.0,
    "coord_epoch_assumed": true,
    "force_refresh": false
  }
}
```

```text
retry: 3000

id: 1
event: job_state
data: {"job_id":"j_fixtfa11ed000001","status":"queued","queue_position":1,"timestamp_utc":"2026-11-15T06:00:00.000Z"}

id: 2
event: failed
data: {"job_id":"j_fixtfa11ed000001","code":"upstream_unavailable","message":"Fixture: IRSA was not called.","retryable":true,"elapsed_s":1.0}
```

`failed.code` is one of `no_coverage`, `upstream_unavailable`, `timeout`, `internal_error`. No other code is defined.

## CORS

The running server's allow-list is `server.cors_allow_origins` from `backend/config.local.yaml`: `http://localhost:5173` only. `backend/config.yaml` ships `[]`. No Vercel hostname is named in this repository, so none is allowed.

`OPTIONS /api/jobs` with `Origin: http://localhost:5173` and `Access-Control-Request-Method: POST` returned 200:

```text
access-control-allow-origin: http://localhost:5173
access-control-allow-methods: GET, HEAD, POST, OPTIONS
access-control-allow-headers: Accept, Accept-Language, Content-Language, Content-Type, If-None-Match, Last-Event-ID
access-control-max-age: 600
vary: Origin
```

`GET /api/health` with `Origin: http://localhost:5173` returned 200 and also `access-control-expose-headers: ETag`.

`GET /api/health` with `Origin: https://spherex-sky-explorer.vercel.app` (not a configured origin; the name is not in the repo) returned 200 with `access-control-expose-headers: ETag` and no `access-control-allow-origin`. `OPTIONS` for that origin returned 400 and no allow-origin header. The Vite dev server proxies `/api` and `/data` to `http://localhost:8000` (`vite.config.ts`), so a page on port 5173 that uses relative `/api` URLs is same-origin to the browser and does not need these headers. A page that calls port 8000 directly does.

## How the frontend should render each state

Treat `queued` (HTTP 202, `cached` false, `joined` false, or an SSE `job_state` of `queued`) as waiting, and keep the event stream open. Treat `running` (HTTP 202 with `joined` true, or SSE `job_state` of `running`) as in progress, and drive the progress UI from `progress` events (`done`, `failed`, `total`). Treat done as HTTP 200 with `cached` true, or an SSE `complete` whose `result_status` is `complete`: then load files from `data_base_url` and check `complete.files`. Treat partial as an SSE `complete` whose `result_status` is `partial`: load the same files and show that some frames were dropped (`n_failed_fetches`). A partial directory is not returned as a cache hit, because the cache requires `meta.status` `complete`; that case was not captured live. Treat `failed` as an SSE `failed` event, or a job GET whose `status` is `failed`: show `code`, `message`, and `retryable`, and do not read `data_base_url`. A new job's HTTP 202 body was not captured, because submitting one would call IRSA. The contract shape is `status` `queued` or `running`, `cached` false, `joined` true only when an in-flight job was joined.
