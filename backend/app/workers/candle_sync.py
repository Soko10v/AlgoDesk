"""Backfill + incremental update of the local OHLCV cache.

On startup this fills any missing history (up to ``candles_years_back`` years) for
the tracked symbols/timeframes, then loops to top up newly closed candles. The
same routine handles both: when a series is empty it backfills from N years ago;
otherwise it fetches only candles newer than the last stored one. Idempotent and
resumable — a redeploy mid-backfill just continues from the last stored candle.
"""

import asyncio
import logging
import time

from app.core.config import get_settings
from app.services import candle_store
from app.services.exchange import exchange_client

logger = logging.getLogger(__name__)
settings = get_settings()

SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT"]
TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d"]
PER_REQUEST = 1000
REFRESH_SEC = 3600.0  # top up once an hour after the initial backfill


async def _update_one(client, symbol: str, timeframe: str, years_back: int) -> int:
    tf_ms = client.parse_timeframe(timeframe) * 1000
    now = client.milliseconds()
    last = await asyncio.to_thread(candle_store.last_ts, symbol, timeframe)
    since = (last + tf_ms) if last else (now - years_back * 365 * 24 * 3600 * 1000)
    written = 0
    while since < now:
        try:
            batch = await client.fetch_ohlcv(symbol, timeframe, since=since, limit=PER_REQUEST)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - skip this series on error, try again next pass
            logger.warning("candle sync fetch failed %s %s: %s", symbol, timeframe, exc)
            break
        if not batch:
            break
        written += await asyncio.to_thread(candle_store.upsert, symbol, timeframe, batch)
        newest = batch[-1][0]
        if newest < since:  # no forward progress — avoid an infinite loop
            break
        since = newest + tf_ms
        if len(batch) < PER_REQUEST:
            break
    return written


async def _update_all(client, years_back: int) -> int:
    total = 0
    for symbol in SYMBOLS:
        for timeframe in TIMEFRAMES:
            total += await _update_one(client, symbol, timeframe, years_back)
    return total


async def sync_candles() -> None:
    """Backfill once, then keep the cache fresh. Safe no-op if the cache is off."""
    if not candle_store.is_ready():
        return
    while True:
        client = exchange_client()
        try:
            t0 = time.time()
            written = await _update_all(client, settings.candles_years_back)
            if written:
                logger.info("candle sync: wrote %d candles in %.0fs", written, time.time() - t0)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - keep the loop alive
            logger.warning("candle sync pass failed: %s", exc)
        finally:
            await client.close()
        await asyncio.sleep(REFRESH_SEC)
