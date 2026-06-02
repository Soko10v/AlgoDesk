#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations..."
alembic upgrade head

echo "[entrypoint] Starting: $*"
exec "$@"
