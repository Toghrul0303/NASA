# Demo runbook

Run every command from the repository root. The default `--config` is `backend/config.yaml`, and that path only resolves from the root.

## Start the server

```
backend\.venv\Scripts\spherex.exe serve
```

Listens on `0.0.0.0:8000` (from `backend/config.yaml`). Check it with:

```
curl.exe http://localhost:8000/api/health
```

`{"status":"ok","version":"1.0.0"}` means it is up. Leave this process running.

## Pre-warm

Only when IRSA is answering, and before the demo, not during it:

```
powershell -File scripts\prewarm.ps1 -File scripts\prewarm.txt
```

The list is `scripts/prewarm.txt` (`ra dec name`, one coordinate per line). The script runs `spherex build-coord --ra --dec --name` for each line, then `spherex validate --slug` on the result, and prints one line: `slug frames=N epochs=N seconds=N`. It does not pass `--force` and it does not delete anything. A coordinate whose directory already exists is skipped; its line says `seconds=skipped` and the frames and epochs come from `meta.json`.

## Check the Tier 1 slugs

```
backend\.venv\Scripts\spherex.exe validate --all
```

This checks every directory under `data/` that has a `meta.json`, including the five Tier 1 slugs: `barnards-star`, `wise-0855`, `eps-indi-b`, `rw-aur`, `r-dra`. Exit 0 and one `OK` line per slug means they are servable. This command reads disk only.

## If IRSA is down

Do nothing to the data. Everything the demo serves is already under `data/`, and `serve` and `validate` do not call IRSA. Do not run `build`, `build-coord`, or `scripts/prewarm.ps1`, and do not POST a coordinate that is not already on disk: those call TAP and will fail, and a failed build leaves the existing directory unchanged.

A repeat of a finished Tier 2 coordinate returns `cached: true` from `meta.json` and does not call IRSA.

## Tier 2 coordinate that is safe to demo

One Tier 2 directory is on disk and `complete`: `data/c-a55d19970b4b8fd7` (120 frames, 3 epochs). POST this body and no other:

```
curl.exe -X POST -H "Content-Type: application/json" -d '{"ra_deg":133.795129,"dec_deg":-7.245147,"size_deg":0.1,"name":"WISE 0855 coord","pmra_mas_yr":-8120,"pmdec_mas_yr":679}' http://localhost:8000/api/jobs
```

Expect HTTP 200 with `"slug":"c-a55d19970b4b8fd7"` and `"cached":true`. Then open `/api/jobs/{job_id}/events`.

The slug includes the proper motion. The same RA and Dec without `pmra_mas_yr` and `pmdec_mas_yr` is a different slug and would call IRSA. `scripts/prewarm.ps1` only passes `--ra`, `--dec` and `--name`, so it cannot rebuild this directory.
