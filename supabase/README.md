# Supabase (hosted PostgreSQL)

AlgoDesk stores durable data in **Supabase Postgres**: users, strategies, trades, subscriptions, encrypted exchange keys.

The **VPS** runs only runtime services: FastAPI (bots + price stream + API), Redis, and the frontend proxy.

## 1. Create a project

1. [supabase.com](https://supabase.com) → New project.
2. Wait until the database is ready.

## 2. Apply schema

**Option A — SQL (one-time)**

1. Dashboard → **SQL Editor**.
2. Paste and run `supabase/migrations/20260603000000_initial.sql`.

**Option B — Alembic (from your machine or CI)**

```bash
cd backend
export DATABASE_URL="postgresql+asyncpg://postgres.[ref]:[PASSWORD]@db.[ref].supabase.co:5432/postgres"
alembic upgrade head
```

**Option C — Supabase CLI**

```bash
supabase link --project-ref <your-ref>
supabase db push
```

After the schema exists, set `RUN_DB_MIGRATIONS=false` on the VPS so the container does not run Alembic on every start.

## 3. Connection string for the backend

Dashboard → **Project Settings** → **Database** → **Connection string**.

Use the **URI** format and switch the driver to async:

```
postgresql+asyncpg://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
```

Recommendations:

| Mode | Port | Use for AlgoDesk backend |
|------|------|---------------------------|
| **Session pooler** | 5432 | Yes — long-lived bots + async SQLAlchemy |
| Transaction pooler | 6543 | Avoid for this app (bots hold connections) |
| Direct | 5432 (`db.*.supabase.co`) | OK for migrations / low connection count |

Put the URL in `infra/.env` as `DATABASE_URL=...`.

SSL is enabled automatically when the host is `*.supabase.co` or `*.supabase.com`.

## 4. VPS `.env` checklist

```env
DATABASE_URL=postgresql+asyncpg://...
REDIS_URL=redis://redis:6379/0
RUN_DB_MIGRATIONS=false
SECRET_KEY=...
FERNET_KEY=...
DEV_AUTH=false
```

Do **not** run a Postgres container on the VPS when using Supabase.
