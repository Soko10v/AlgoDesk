import asyncio
import logging
import time

from sqlalchemy import select

from app.core.redis import redis_client
from app.models.strategy import Strategy
from app.services.exchange import exchange_client

logger = logging.getLogger(__name__)

# Always keep these warm (used on the dashboard / as sensible defaults) even when
# no bot trades them.
BASE_SYMBOLS = ("BTC/USDT", "ETH/USDT")


async def _active_symbols(session_factory) -> set[str]:
    """Symbols of every running (paper/live) strategy, plus the base set, so the
    price feed covers exactly what the bots need."""
    symbols = set(BASE_SYMBOLS)
    try:
        async with session_factory() as db:
            configs = (
                await db.execute(select(Strategy.config_json).where(Strategy.status.in_(["paper", "live"])))
            ).scalars().all()
        for cfg in configs:
            if not cfg:
                continue
            for key in ("symbol", "symbol_a", "symbol_b"):
                sym = cfg.get(key)
                if sym:
                    symbols.add(sym)
    except Exception as exc:  # noqa: BLE001 - keep the previous set on a DB hiccup
        logger.warning("could not refresh active symbols: %s", exc)
    return symbols


async def stream_symbols(session_factory, interval: float = 1.0, refresh_sec: float = 20.0) -> None:
    """Poll public tickers for all active strategies' symbols and publish last
    prices to Redis. The symbol set is refreshed from the DB periodically, so a
    bot started on any ticker (not just BTC/ETH) gets a live price within
    ``refresh_sec``. Resilient: a single failed fetch never kills the stream."""
    client = exchange_client()
    symbols: set[str] = set(BASE_SYMBOLS)
    last_refresh = 0.0
    try:
        while True:
            now = time.time()
            if now - last_refresh >= refresh_sec:
                symbols = await _active_symbols(session_factory)
                last_refresh = now
            for symbol in list(symbols):
                try:
                    ticker = await client.fetch_ticker(symbol)
                    last = ticker.get("last")
                    if last:
                        await redis_client.set(f"price:{symbol.replace('/', '_')}", float(last))
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001 - keep streaming other symbols
                    logger.warning("price fetch failed for %s: %s", symbol, exc)
            await asyncio.sleep(interval)
    finally:
        await client.close()
