# Supabase (hosted PostgreSQL + Auth)

AlgoDesk stores durable data in **Supabase Postgres** and uses **Supabase Auth** (email/password) for login.

The **VPS** runs only runtime services: FastAPI (bots + price stream + API), Redis, and the frontend proxy.

## 1. Create a project

1. [supabase.com](https://supabase.com) → New project.
2. Wait until the database is ready.

## 2. Enable Auth (email/password)

1. Dashboard → **Authentication** → **Providers**.
2. Enable **Email**.
3. For quick testing: **Authentication** → **Sign In / Providers** → disable **Confirm email** (optional).
4. For production: enable email confirmation.

## 3. Apply schema

Run both SQL files in order in **SQL Editor**:

1. `supabase/migrations/20260603000000_initial.sql`
2. `supabase/migrations/20260603100000_supabase_auth.sql`

Or from the backend machine:

```bash
cd backend
export DATABASE_URL="postgresql+asyncpg://postgres.[ref]:[PASSWORD]@db.[ref].supabase.co:5432/postgres"
alembic upgrade head
```

After the schema exists, set `RUN_DB_MIGRATIONS=false` on the VPS.

## 4. API keys and connection string

**Project Settings** → **API**:

- `Project URL` → `SUPABASE_URL` and `VITE_SUPABASE_URL`
- `anon` `public` key → `SUPABASE_ANON_KEY` and `VITE_SUPABASE_ANON_KEY`

**Project Settings** → **Database** → **Connection string** (Session pooler, port 5432):

```
postgresql+asyncpg://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
```

→ `DATABASE_URL` in `infra/.env`

SSL to Supabase Postgres is enabled automatically in the backend.

## 5. VPS `.env` checklist

```env
DATABASE_URL=postgresql+asyncpg://...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
REDIS_URL=redis://redis:6379/0
RUN_DB_MIGRATIONS=false
SECRET_KEY=...
FERNET_KEY=...
DEV_AUTH=false
FRONTEND_ORIGIN=https://your-domain
```

Rebuild frontend after changing `VITE_*` vars (`docker compose up --build`).

## 6. Auth flow

1. User signs up / signs in on the frontend via `@supabase/supabase-js`.
2. Frontend sends Supabase `access_token` as `Authorization: Bearer` to FastAPI.
3. Backend validates token with `GET /auth/v1/user`, then creates/loads row in `users` by `auth_user_id`.

Do **not** put the Supabase **service_role** key in the browser or frontend build.
