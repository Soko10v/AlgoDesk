import asyncio
import logging

from app.core.redis import redis_client
from app.services.bybit import bybit_client

logger = logging.getLogger(__name__)


async def stream_symbols(symbols: list[str], interval: float = 1.0) -> None:
    """Poll Bybit tickers and publish last prices to Redis. Resilient to
    transient errors so a single failed fetch does not kill the stream."""
    client = bybit_client()
    try:
        while True:
            for symbol in symbols:
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
