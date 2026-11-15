# SPHEREx Sky Explorer API. Python 3.11 matches BACKEND_SPEC.
# uv installs the locked dependencies; it is not an application dependency.
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim

WORKDIR /app

COPY backend/pyproject.toml backend/uv.lock /app/backend/
RUN cd /app/backend && uv sync --frozen --no-dev --no-install-project

COPY backend/src /app/backend/src
COPY backend/config.yaml /app/backend/config.yaml
COPY backend/schemas /app/backend/schemas
COPY backend/config/targets.resolved.json /app/backend/config/targets.resolved.json
COPY docs/DATA_CONTRACT.md /app/docs/DATA_CONTRACT.md
COPY data/barnards-star /app/data/barnards-star
COPY data/wise-0855 /app/data/wise-0855
COPY data/eps-indi-b /app/data/eps-indi-b
COPY data/rw-aur /app/data/rw-aur
COPY data/r-dra /app/data/r-dra
COPY data/c-a55d19970b4b8fd7 /app/data/c-a55d19970b4b8fd7

ENV PATH="/app/backend/.venv/bin:${PATH}" \
    PYTHONPATH="/app/backend/src" \
    PYTHONUNBUFFERED="1" \
    SPHEREX_CONFIG="/app/backend/config.yaml" \
    DATA_DIR="/app/data" \
    HOST="0.0.0.0" \
    PORT="8000" \
    ENABLE_LIVE_JOBS="false"

EXPOSE 8000

# Railway overrides PORT. One worker: job state lives in the process.
CMD ["sh", "-c", "exec uvicorn spherex_backend.asgi:app --host 0.0.0.0 --port $PORT --workers 1"]
