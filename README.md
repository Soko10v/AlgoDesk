# AlgoDesk

No-code algorithmic trading bot constructor for crypto traders.

## Stack

- Backend: Python 3.11, FastAPI, SQLAlchemy (async), Redis, CCXT
- Database & auth: **Supabase** (PostgreSQL + email/password Auth)
- Frontend: React 18, Vite, TypeScript, TailwindCSS, Zustand, React Query
- Infra: Docker on VPS (Redis + API/workers + nginx); no Postgres on VPS

## Project structure

- `backend`: API, models, services, trading engine, workers
- `frontend`: web app, visual strategy builder, dashboard
- `infra`: Docker Compose and environment template
- `supabase`: SQL migrations and setup guide for hosted Postgres

## Data split (Supabase vs VPS)

| Supabase (durable) | VPS (runtime) |
| --- | --- |
| Auth (`auth.users`) + app profiles, encrypted exchange keys | Live price stream (Bybit → Redis) |
| Strategies (`config_json`, status) | Bot supervisor (in-process state) |
| Trades history | Redis: `price:*`, `closes:*`, pub/sub for WebSocket |
| Subscriptions / payments state | FastAPI, CCXT live orders, Telegram alerts |

See `supabase/README.md` for creating a project and applying the schema.

## Quick start (VPS / production)

1. Create a Supabase project, enable Email auth, run both SQL migrations in `supabase/migrations/` (or `alembic upgrade head` once).
2. Configure `infra/.env` from `.env.example` with `DATABASE_URL`, `SUPABASE_*`, `VITE_SUPABASE_*`, and `RUN_DB_MIGRATIONS=false`.
3. Deploy:

```bash
cd infra
cp .env.example .env   # fill Supabase URL, secrets, DEV_AUTH=false
docker compose up --build -d
```

Open the app on port **8080** (nginx in the frontend container).

## Quick start (local, no Supabase)

```bash
cd infra
cp .env.example .env
# Uncomment the local DATABASE_URL + RUN_DB_MIGRATIONS=true lines in .env
docker compose --profile local-db up --build
```

## Logging in

- **Email + password** via Supabase Auth on the login page.
- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the frontend build, and
  `SUPABASE_URL` / `SUPABASE_ANON_KEY` for the backend (token validation).
- Optional: `TELEGRAM_BOT_TOKEN` still sends trade alerts if users have a `telegram_id` linked later.

## Environment

Edit `infra/.env`. Important values:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Supabase Postgres (`postgresql+asyncpg://...`) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Backend validates Supabase access tokens |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Frontend Supabase Auth client (build-time) |
| `RUN_DB_MIGRATIONS` | `false` on VPS after schema exists; `true` for local Postgres profile |
| `REDIS_URL` | Ephemeral prices and WS events (stays on VPS) |
| `SECRET_KEY` | Legacy/internal signing (retained for compatibility) |
| `FERNET_KEY` | Encrypts exchange API keys at rest |
| `TELEGRAM_BOT_TOKEN` | Optional trade alerts |
| `CRYPTOBOT_TOKEN` | CryptoBot (USDT) payments |

Generate fresh secrets:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"   # FERNET_KEY
python -c "import secrets; print(secrets.token_urlsafe(48))"                                 # SECRET_KEY
```

## Architecture notes

- The **backend process owns the live price stream and all running bots**.
  Bot runtime state lives in-process, so run a **single backend replica**.
- On startup the backend **recovers** any strategy whose status is `paper` or
  `live`, so bots survive restarts.
- When a bot starts it **seeds indicator history** from Bybit OHLCV, so MA/RSI
  signals are available immediately instead of accumulating from zero.
- Stop-loss and take-profit (percent) are enforced in the engine loop **and**, in
  live mode, mirrored as a real reduce-only **exchange-side stop order** so the
  position is protected even if this process dies or price gaps between ticks.
  The backtester now applies the same stop-loss/take-profit (gap-aware fills),
  so its drawdown reflects what the live engine would actually take.
- Strategies are **spot** (long-only) by default, or **futures** (linear perp,
  with leverage capped at 10x). Futures bots can set `direction="both"` to trade
  **both ways**: long while the fast MA is above the slow MA, short while below,
  flipping on the opposite cross (SL/TP protect either side). `direction="long"`
  (the default, and the only option on spot) keeps the original long-only flow.
- Futures strategies can add a **hedge**: a leg opposite the open position that
  offsets sharp adverse moves. Two modes — `auto_squeeze` (opens on a fast
  adverse move, releases on rebound) and `constant_partial` (always holds a share
  of the position hedged). Hedge fills are recorded as trades with `leg="hedge"`.
- Live trading only runs when a strategy has `live_enabled = true`.
- API keys are **Fernet-encrypted** before being stored in Supabase.

> ⚠️ **Live futures/hedge orders are exchange-specific and must be validated on a
> testnet before trading real funds.** Holding a long and a short on the same
> symbol at once requires the futures account to be in **hedge mode**. Paper mode
> and the backtester simulate everything safely with no real orders.

## Local development (without Docker)

Requires Redis locally and either Supabase `DATABASE_URL` or a local Postgres.

Backend:

```bash
cd backend
python -m venv .venv
. .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -e .
alembic upgrade head            # skip if schema already in Supabase
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
npm run typecheck    # type-check only
npm run build        # production build
```

## Database migrations

- **Supabase**: apply SQL in `supabase/migrations/` or run `alembic upgrade head` once against your project URL.
- **Docker + local Postgres profile**: migrations run on backend start when `RUN_DB_MIGRATIONS=true`.

New revision after model changes:

```bash
docker compose exec backend alembic revision --autogenerate -m "change"
docker compose exec backend alembic upgrade head
# Then add equivalent SQL under supabase/migrations/ for Supabase-only deploys
```
