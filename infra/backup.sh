#!/usr/bin/env bash
# Database backup for AlgoDesk.
#
# Dumps the Postgres database referenced by DATABASE_URL to a timestamped,
# gzip-compressed file, keeps the most recent BACKUP_KEEP files, and (optionally)
# copies the dump off-site with rclone.
#
# Usage (run on the VPS, e.g. from cron):
#   DATABASE_URL=... BACKUP_DIR=/root/algodesk-backups ./infra/backup.sh
#
# Cron example (daily at 03:30, keep 14 days):
#   30 3 * * * cd /root/AlgoDesk && DATABASE_URL="$(grep ^DATABASE_URL infra/.env | cut -d= -f2-)" \
#     BACKUP_DIR=/root/algodesk-backups BACKUP_KEEP=14 ./infra/backup.sh >> /var/log/algodesk-backup.log 2>&1
#
# Off-site copy (recommended): set RCLONE_REMOTE=myremote:algodesk-backups and
# have rclone configured. A backup on the same VPS does NOT survive losing the VPS.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL (postgres connection string)}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"

# pg_dump doesn't understand SQLAlchemy's "+asyncpg" driver suffix — strip it.
PG_URL="${DATABASE_URL/+asyncpg/}"
PG_URL="${PG_URL/+psycopg2/}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/algodesk-$STAMP.sql.gz"

echo "[backup] dumping to $OUT"
# Prefer a Dockerized pg_dump so the host needs no postgres-client installed.
if command -v pg_dump >/dev/null 2>&1; then
  pg_dump "$PG_URL" | gzip > "$OUT"
else
  docker run --rm -i postgres:16 pg_dump "$PG_URL" | gzip > "$OUT"
fi

# Fail loudly if the dump is suspiciously small (empty/error output).
SIZE=$(wc -c < "$OUT")
if [ "$SIZE" -lt 1000 ]; then
  echo "[backup] ERROR: dump is only ${SIZE} bytes — treating as failure" >&2
  exit 1
fi
echo "[backup] ok: ${SIZE} bytes"

# Off-site copy (optional).
if [ -n "${RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null 2>&1; then
  echo "[backup] uploading to $RCLONE_REMOTE"
  rclone copy "$OUT" "$RCLONE_REMOTE"
fi

# Rotate: keep the newest BACKUP_KEEP dumps.
ls -1t "$BACKUP_DIR"/algodesk-*.sql.gz 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | while read -r old; do
  echo "[backup] pruning $old"
  rm -f "$old"
done
echo "[backup] done"
