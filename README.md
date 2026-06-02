# AlgoDesk

No-code algorithmic trading bot constructor for crypto traders.

## Stack

- Backend: Python 3.11, FastAPI, SQLAlchemy (async), Redis, CCXT
- Frontend: React 18, Vite, TypeScript, TailwindCSS, Zustand, React Query
- Infra: Docker + Docker Compose

## Project structure

- `backend`: API, models, services, trading engine, workers
- `frontend`: web app, visual strategy builder, dashboard
- `infra`: Docker Compose and environment template

## Quick start (Docker)

```bash
cd infra
cp .env.example .env   # already filled with dev defaults in this repo
docker compose up --build
```

Then open:

- Frontend: http://localhost:5173
- Backend: http://localhost:8000
- API docs: http://localhost:8000/docs

Database migrations run **automatically** when the backend container starts
(see `backend/entrypoint.sh`), so the database is ready on first boot.

## Logging in

- **Dev login** (default): when `DEV_AUTH=true`, the login screen shows a
  username field that issues a session instantly — no Telegram bot required.
  Disable it with `DEV_AUTH=false` in production.
- **Telegram OAuth**: set `TELEGRAM_BOT_USERNAME` and `TELEGRAM_BOT_TOKEN`,
  point your bot's domain (BotFather → `/setdomain`) at the public frontend
  URL, and the official Telegram Login Widget appears automatically.

## Environment

Edit `infra/.env`. Important values:

| Variable | Purpose |
| --- | --- |
| `SECRET_KEY` | JWT signing key |
| `FERNET_KEY` | Encrypts exchange API keys at rest |
| `DEV_AUTH` | Enables the dev login bypass (set `false` in prod) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` | Telegram OAuth + alerts |
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
- Stop-loss and take-profit (percent) are enforced in the engine loop.
- Live trading only runs when a strategy has `live_enabled = true`.
- API keys are **Fernet-encrypted** before being stored.

## Local development (without Docker)

Backend:

```bash
cd backend
python -m venv .venv
. .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -e .
alembic upgrade head
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

Migrations run automatically in Docker. To create a new one after changing models:

```bash
docker compose exec backend alembic revision --autogenerate -m "change"
docker compose exec backend alembic upgrade head
```
