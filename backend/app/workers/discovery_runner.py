"""Rebuild the "best strategies" board on a slow cadence.

Runs the discovery sweep on startup (once the candle cache has warmed up) and
then every couple of days, replacing the stored board each time. Global data —
every user sees the same board — so it runs once per process, not per user.
"""

import asyncio
import logging

from sqlalchemy import delete, func, select

from app.models.discovered import DiscoveredStrategy
from app.services.discovery import discover

logger = logging.getLogger(__name__)

REFRESH_SEC = 2 * 24 * 3600.0  # rebuild every 2 days
STARTUP_DELAY_SEC = 180.0      # let candle_sync backfill first on a cold start
RETRY_SEC = 3600.0             # if a pass fails, retry in an hour instead of waiting 2 days


async def _count(session_factory) -> int:
    async with session_factory() as db:
        return (await db.execute(select(func.count()).select_from(DiscoveredStrategy))).scalar() or 0


async def _replace(session_factory, rows: list[dict]) -> None:
    if not rows:
        return  # keep the previous board rather than blanking it on an empty result
    async with session_factory() as db:
        await db.execute(delete(DiscoveredStrategy))
        db.add_all([DiscoveredStrategy(**row) for row in rows])
        await db.commit()


async def run_discovery(session_factory) -> None:
    """Background loop: initial build (if the board is empty/stale) then periodic refresh."""
    # On a warm redeploy the board already exists — don't hammer the sweep on every
    # restart; only build immediately if it's empty, otherwise wait a full cycle.
    try:
        existing = await _count(session_factory)
    except Exception as exc:  # noqa: BLE001 - table may not exist yet on first migrate
        logger.warning("discovery: initial count failed: %s", exc)
        existing = 0

    if existing == 0:
        await asyncio.sleep(STARTUP_DELAY_SEC)

    while True:
        try:
            rows = await discover()
            await _replace(session_factory, rows)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - keep the loop alive; retry sooner
            logger.warning("discovery pass failed: %s", exc)
            await asyncio.sleep(RETRY_SEC)
            continue
        await asyncio.sleep(REFRESH_SEC)
