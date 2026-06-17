"""Local OHLCV cache (SQLite).

Backtests, the optimizer and walk-forward read candles from here instead of the
exchange — instant, no rate limits, and able to span years. A background worker
(``app.workers.candle_sync``) backfills history once and tops up new candles.

SQLite is plenty for a few million rows. All access is synchronous; callers wrap
these in ``asyncio.to_thread`` so the event loop stays free. Each call uses its
own connection (sqlite3 connections aren't shareable across threads), with WAL so
reads and the single writer don't block each other. If the DB can't be opened
(e.g. no writable volume in local dev), the cache disables itself and callers
fall back to a live exchange fetch.
"""

import logging
import os
import sqlite3
import threading
from typing import Any

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_DB_PATH = settings.candles_db_path
_lock = threading.Lock()
_ready = False


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_db() -> bool:
    """Create the table if needed. Returns False (and disables the cache) if the
    path isn't writable, so the app still runs against live fetches."""
    global _ready
    with _lock:
        if _ready:
            return True
        if not _DB_PATH:
            return False
        try:
            parent = os.path.dirname(_DB_PATH)
            if parent:
                os.makedirs(parent, exist_ok=True)
            conn = _connect()
            try:
                conn.execute(
                    """CREATE TABLE IF NOT EXISTS candles(
                        symbol TEXT NOT NULL,
                        timeframe TEXT NOT NULL,
                        ts INTEGER NOT NULL,
                        o REAL, h REAL, l REAL, c REAL, v REAL,
                        PRIMARY KEY (symbol, timeframe, ts)
                    )"""
                )
                conn.commit()
            finally:
                conn.close()
            _ready = True
            logger.info("candle cache ready at %s", _DB_PATH)
            return True
        except Exception as exc:  # noqa: BLE001 - degrade gracefully to live fetch
            logger.warning("candle cache unavailable (%s): %s — using live fetch", _DB_PATH, exc)
            return False


def is_ready() -> bool:
    return _ready


def upsert(symbol: str, timeframe: str, rows: list[list[float]]) -> int:
    if not _ready or not rows:
        return 0
    payload = [
        (symbol, timeframe, int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]),
         float(r[5]) if len(r) > 5 and r[5] is not None else 0.0)
        for r in rows if r and r[0] is not None
    ]
    conn = _connect()
    try:
        conn.executemany(
            "INSERT OR REPLACE INTO candles(symbol,timeframe,ts,o,h,l,c,v) VALUES(?,?,?,?,?,?,?,?)",
            payload,
        )
        conn.commit()
        return len(payload)
    finally:
        conn.close()


def last_ts(symbol: str, timeframe: str) -> int | None:
    if not _ready:
        return None
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT MAX(ts) FROM candles WHERE symbol=? AND timeframe=?", (symbol, timeframe)
        ).fetchone()
        return int(row[0]) if row and row[0] is not None else None
    finally:
        conn.close()


def get_candles(
    symbol: str,
    timeframe: str,
    since_ms: int | None = None,
    until_ms: int | None = None,
    limit: int = 2000,
) -> list[list[float]]:
    """Ascending [ts,o,h,l,c,v] rows. With no bounds, returns the most recent
    ``limit`` candles (matching the live-fetch default)."""
    if not _ready:
        return []
    conn = _connect()
    try:
        if since_ms is None and until_ms is None:
            rows = conn.execute(
                "SELECT ts,o,h,l,c,v FROM candles WHERE symbol=? AND timeframe=? ORDER BY ts DESC LIMIT ?",
                (symbol, timeframe, limit),
            ).fetchall()
            rows = rows[::-1]
        else:
            q = "SELECT ts,o,h,l,c,v FROM candles WHERE symbol=? AND timeframe=?"
            p: list[Any] = [symbol, timeframe]
            if since_ms is not None:
                q += " AND ts>=?"
                p.append(int(since_ms))
            if until_ms is not None:
                q += " AND ts<=?"
                p.append(int(until_ms))
            q += " ORDER BY ts ASC LIMIT ?"
            p.append(limit)
            rows = conn.execute(q, p).fetchall()
        return [[r[0], r[1], r[2], r[3], r[4], r[5]] for r in rows]
    finally:
        conn.close()


def coverage() -> list[dict[str, Any]]:
    """Per (symbol, timeframe): how many candles and the first/last timestamp (ms)."""
    if not _ready:
        return []
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT symbol,timeframe,COUNT(*),MIN(ts),MAX(ts) FROM candles GROUP BY symbol,timeframe"
        ).fetchall()
        return [
            {"symbol": r[0], "timeframe": r[1], "count": r[2], "first": r[3], "last": r[4]}
            for r in rows
        ]
    finally:
        conn.close()
