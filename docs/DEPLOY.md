# Deploy

The API image serves the six directories already on disk and does not call IRSA when `ENABLE_LIVE_JOBS=false`. Those directories are the five Tier 1 slugs (`barnards-star`, `wise-0855`, `eps-indi-b`, `rw-aur`, `r-dra`) and the Tier 2 preset `c-a55d19970b4b8fd7`. Together they are 19,129,333 bytes (about 18.2 MiB). `data_backup/` is gitignored and excluded from the image. `public/data` and the test trees are excluded too.

Docker is not required on the laptop that prepares the repo. The container command is the same process verified below with uvicorn.

## Railway

1. Push this repo. The Dockerfile is at the repository root. Railway builds it; there is no separate start command to set if the Dockerfile is detected.
2. The image installs locked dependencies with uv, copies the backend, `docs/DATA_CONTRACT.md`, and only the six slug directories into `/app/data`. It does not copy `data_backup/`, `public/data`, or tests.
3. Set the variables in the next section, then deploy.
4. Open the generated `https://<service>.up.railway.app` URL and run the smoke tests against it. `PORT` is injected by Railway. The process is `uvicorn spherex_backend.asgi:app --host 0.0.0.0 --port $PORT --workers 1`.
5. Put that origin in the Vercel variables and redeploy the frontend.

`config.local.yaml` is not in the image. Production CORS comes from `CORS_ORIGINS`. The image sets `ENABLE_LIVE_JOBS=false` so a forgotten variable does not open IRSA. Set it on Railway anyway.

## Backend environment

| Variable | Production value | Role |
|---|---|---|
| `CORS_ORIGINS` | comma-separated exact origins, for example `https://<app>.vercel.app` | Replaces `server.cors_allow_origins`. Unset falls back to `config.local.yaml` (locally `http://localhost:5173`; in the image the yaml list is empty). |
| `CORS_ORIGIN_REGEX` | optional, for example `https://.*\.vercel\.app` | Whole-origin match for Vercel preview URLs. Leave unset to allow only the exact list. |
| `ENABLE_LIVE_JOBS` | `false` | Cached complete slugs still return 200. Any other `POST /api/jobs` returns 503 `live_jobs_disabled` and does not call IRSA. Code default is true; the image and Railway set false. |
| `DATA_DIR` | `/app/data` | Directory served as `/data`. The image sets this. A laptop sets it to the repo `data/` directory. |
| `PORT` | set by Railway | uvicorn binds this port. |
| `HOST` | `0.0.0.0` | Set in the image. `spherex serve` uses `HOST`, then `config.yaml`. |
| `SPHEREX_CONFIG` | `/app/backend/config.yaml` | Set in the image. |

One worker. Do not raise `--workers`.

## Vercel environment

Set these on the frontend project, then redeploy so Vite inlines them:

| Variable | Value |
|---|---|
| `VITE_API_BASE` | `https://<service>.up.railway.app` (no trailing slash) |
| `VITE_DATA_BASE` | the same origin (the API serves `/data`) |
| `VITE_ENABLE_LIVE_RUN` | `0` |
| `VITE_USE_MOCKS` | `0` |

`VITE_API_BASE`, `VITE_DATA_BASE`, and `VITE_USE_MOCKS` are read by `src/config/env.ts`. `VITE_ENABLE_LIVE_RUN` is the flag to set for the hosted app; the switch that actually stops IRSA is `ENABLE_LIVE_JOBS=false` on the API. With mocks off, the browser calls the Railway origin for `/api` and `/data` and does not call IRSA or ESA.

## Smoke tests

Replace `BASE` with `http://127.0.0.1:8000` or the Railway URL. The server under test must have `ENABLE_LIVE_JOBS=false` and `CORS_ORIGINS` including the origin you send.

```text
set BASE=http://127.0.0.1:8000
```

Health:

```text
curl.exe -i %BASE%/api/health
```

Expect `200` and `{"status":"ok","version":"1.0.0"}`.

`meta.json` for the six shipped slugs. Each must be `200`:

```text
curl.exe -o NUL -w "barnards-star %{http_code}\n" %BASE%/data/barnards-star/meta.json
curl.exe -o NUL -w "wise-0855 %{http_code}\n" %BASE%/data/wise-0855/meta.json
curl.exe -o NUL -w "eps-indi-b %{http_code}\n" %BASE%/data/eps-indi-b/meta.json
curl.exe -o NUL -w "rw-aur %{http_code}\n" %BASE%/data/rw-aur/meta.json
curl.exe -o NUL -w "r-dra %{http_code}\n" %BASE%/data/r-dra/meta.json
curl.exe -o NUL -w "c-a55d19970b4b8fd7 %{http_code}\n" %BASE%/data/c-a55d19970b4b8fd7/meta.json
```

Preflight from an allowed origin. Expect `200` and `access-control-allow-origin` equal to that origin. `access-control-allow-headers` includes `Last-Event-ID`.

```text
curl.exe -i -X OPTIONS %BASE%/api/jobs -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type,last-event-id"
```

A disallowed origin gets no `access-control-allow-origin` header:

```text
curl.exe -D - -o NUL %BASE%/api/health -H "Origin: https://evil.example"
```

The same allow-origin header is on `/data` for an allowed origin:

```text
curl.exe -D - -o NUL %BASE%/data/barnards-star/meta.json -H "Origin: http://localhost:5173"
```

Cached preset. This is the WISE 0855 coordinate whose directory is `c-a55d19970b4b8fd7`. Expect `200`, `"cached": true`, and that slug. The server log must not show a TAP request.

```text
curl.exe -i -X POST %BASE%/api/jobs -H "Content-Type: application/json" -d "{\"ra_deg\":133.795129,\"dec_deg\":-7.245147,\"size_deg\":0.1,\"name\":\"WISE 0855 coord\",\"pmra_mas_yr\":-8120,\"pmdec_mas_yr\":679}"
```

Uncached coordinate (Proxima Centauri, not on disk). Expect `503` and `"code": "live_jobs_disabled"`. This must not call IRSA.

```text
curl.exe -i -X POST %BASE%/api/jobs -H "Content-Type: application/json" -d "{\"ra_deg\":217.42894,\"dec_deg\":-62.67949,\"size_deg\":0.1,\"name\":\"Proxima Centauri\"}"
```

## Laptop fallback

When Railway is down, run the same process on the laptop and publish it with a tunnel. From the repository root, with the backend venv:

```text
set PORT=8000
set HOST=0.0.0.0
set DATA_DIR=%CD%\data
set ENABLE_LIVE_JOBS=false
set CORS_ORIGINS=https://<app>.vercel.app
set PYTHONPATH=backend\src
backend\.venv\Scripts\python.exe -m uvicorn spherex_backend.asgi:app --host 0.0.0.0 --port %PORT% --workers 1
```

`spherex serve` reads the same `PORT`, `HOST`, and `DATA_DIR` and also stays on one worker.

In another terminal, give that port a public HTTPS URL:

```text
cloudflared tunnel --url http://127.0.0.1:8000
```

Put the `https://*.trycloudflare.com` URL in `CORS_ORIGINS` (restart uvicorn after changing it) and in the Vercel `VITE_API_BASE` and `VITE_DATA_BASE`, then redeploy the frontend. Keep `ENABLE_LIVE_JOBS=false`. Run the smoke tests against the tunnel URL. Shut the tunnel down when the demo is over; it is not a substitute for the Railway service.
