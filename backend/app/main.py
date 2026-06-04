import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.workers.bot_supervisor import bot_supervisor
from app.workers.price_stream import stream_symbols

logging.basicConfig(level=logging.INFO)
settings = get_settings()
price_stream_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global price_stream_task
    price_stream_task = asyncio.create_task(stream_symbols(["BTC/USDT", "ETH/USDT"]))
    try:
        await bot_supervisor.recover(SessionLocal)
    except Exception:
        logging.getLogger(__name__).exception(
            "Bot recovery failed on startup; API will run but bots may need a manual restart"
        )
    yield
    await bot_supervisor.shutdown()
    if price_stream_task:
        price_stream_task.cancel()
        await asyncio.gather(price_stream_task, return_exceptions=True)


app = FastAPI(title="AlgoDesk API", version="0.1.0", lifespan=lifespan)
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
