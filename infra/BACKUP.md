# Backups & disaster recovery

Two things must survive losing the VPS, or user funds become unmanageable:

1. **The database** — users, strategies, trade history, encrypted API keys.
2. **`FERNET_KEY`** — the key that decrypts stored exchange API keys. Without it,
   every stored API key is permanently unreadable and users must reconnect.

## Database

### If you use Supabase (managed Postgres)
Supabase takes automated backups. On the **Pro** plan you also get
Point-in-Time Recovery. Verify in the Supabase dashboard → Database → Backups
that backups are enabled, and occasionally test a restore. The script below
still works against Supabase as a second, off-site copy you control.

### If you self-host Postgres on the VPS
Schedule `infra/backup.sh` from cron. It dumps `DATABASE_URL`, compresses,
rotates, and (optionally) uploads off-site with rclone.

```bash
# daily at 03:30, keep 14 days, copy off-site
30 3 * * * cd /root/AlgoDesk && \
  DATABASE_URL="$(grep ^DATABASE_URL infra/.env | cut -d= -f2-)" \
  BACKUP_DIR=/root/algodesk-backups BACKUP_KEEP=14 \
  RCLONE_REMOTE=myremote:algodesk-backups \
  ./infra/backup.sh >> /var/log/algodesk-backup.log 2>&1
```

A backup that lives only on the same VPS does **not** protect you from losing
that VPS. Always keep an off-site copy (rclone to S3/Backblaze/Google Drive,
or Supabase's own backups).

### Restore
```bash
gunzip -c algodesk-YYYYMMDD-HHMMSS.sql.gz | psql "$DATABASE_URL_WITHOUT_ASYNCPG"
```

## FERNET_KEY

`FERNET_KEY` lives in `infra/.env` (git-ignored). Store a copy in a password
manager / secrets vault **separately from the database backup**. If you rotate
the VPS or recreate `.env`, restoring the database without the original
`FERNET_KEY` leaves all stored API keys undecryptable.

Rotating the key (advanced): decrypt all secrets with the old key and
re-encrypt with the new one in a one-off migration; otherwise users simply
reconnect their exchange keys.
