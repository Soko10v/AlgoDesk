"""Background loop: refresh arbitrage opportunity snapshot into Redis."""

from __future__ import annotations

import asyncio
import json
import logging
import time

from app.core.redis import redis_client
from app.arbitrage.opportunities import scan_all

logger = logging.getLogger(__name__)

REDIS_KEY = "arb:opportunities"
REFRESH_SEC = 45.0
STARTUP_DELAY_SEC = 5.0


async def run_arb_scanner() -> None:
    """Poll public markets and cache a JSON snapshot for the API."""
    await asyncio.sleep(STARTUP_DELAY_SEC)
    while True:
        try:
            snap = await scan_all()
            snap["updated_at"] = time.time()
            await redis_client.set(REDIS_KEY, json.dumps(snap), ex=int(REFRESH_SEC * 4))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - keep the loop alive
            logger.warning("arb scanner pass failed: %s", exc)
        await asyncio.sleep(REFRESH_SEC)


async def get_cached_opportunities() -> dict | None:
    raw = await redis_client.get(REDIS_KEY)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
