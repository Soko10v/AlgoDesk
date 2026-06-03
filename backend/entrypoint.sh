#!/bin/sh
set -e

if [ "${RUN_DB_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] Applying database migrations..."
  alembic upgrade head
else
  echo "[entrypoint] Skipping migrations (RUN_DB_MIGRATIONS=false)"
fi

echo "[entrypoint] Starting: $*"
exec "$@"
