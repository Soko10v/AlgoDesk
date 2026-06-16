import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.core.ratelimit import limiter
from app.services.telegram_alerts import send_admin_alert
from app.workers.bot_supervisor import bot_supervisor
from app.workers.price_stream import stream_symbols

logging.basicConfig(level=logging.INFO)
settings = get_settings()

# Error monitoring (optional): only initialised when a DSN is configured.
if settings.sentry_dsn:
    try:
        import sentry_sdk

        sentry_sdk.init(dsn=settings.sentry_dsn, traces_sample_rate=0.0, send_default_pii=False)
    except Exception:  # noqa: BLE001 - monitoring must never block startup
        logging.getLogger(__name__).exception("Sentry init failed")

background_tasks: list[asyncio.Task] = []


@asynccontextmanager
async def lifespan(_: FastAPI):
    background_tasks.append(asyncio.create_task(stream_symbols(SessionLocal)))
    try:
        await bot_supervisor.recover(SessionLocal)
    except Exception:
        logging.getLogger(__name__).exception(
            "Bot recovery failed on startup; API will run but bots may need a manual restart"
        )
        await send_admin_alert("bot recovery FAILED on startup — bots may need a manual restart")
    # Watchdog + position-drift monitor.
    background_tasks.append(asyncio.create_task(bot_supervisor.monitor(SessionLocal)))
    yield
    await bot_supervisor.shutdown()
    for task in background_tasks:
        task.cancel()
    await asyncio.gather(*background_tasks, return_exceptions=True)


app = FastAPI(title="AlgoDesk API", version="0.1.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)
app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
async def health() -> dict:
    return {"ok": True}
