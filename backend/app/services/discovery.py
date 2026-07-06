"""Auto-discovery of the "best strategies" board.

Brute-forces entry types × entry params × per-side filters over the last ~30 days
for a small set of liquid symbols/timeframes, scores each on the same
risk-adjusted metric the optimizer uses, and returns the top handful. Everything
is spot + long-only so the results are safe to hand a complete beginner (no
leverage, no shorting) and the search space stays tractable.

The heavy inner loop reuses backtest.py's own primitives (_entry_variations,
_filter_candidates, _simulate, _score) so "discovered" strategies are scored
exactly like a user's own backtest — no separate, drifting code path.
"""

import asyncio
import copy
import logging
import time
from typing import Any

from app.services.backtest import (
    _closed_trades,
    _entry_variations,
    _filter_candidates,
    _finite_result,
    _score,
    _simulate,
    load_candles,
)

logger = logging.getLogger(__name__)

DISCOVERY_SYMBOLS = ["BTC/USDT", "ETH/USDT"]
DISCOVERY_TIMEFRAMES = ["15m", "1h", "4h"]
ENTRY_TYPES = ["ma_cross", "ema_cross", "rsi", "breakout", "macd"]

# A few sane risk profiles rather than the optimizer's full grid — keeps the
# sweep to a few thousand sims total instead of tens of thousands.
#   (stop_loss %, take_profit % [0 = ride to exit signal], trailing %)
DISCOVERY_RISK: list[tuple[float, float, float]] = [
    (2.0, 0.0, 0.0),  # ride to the exit signal, hard stop only
    (3.0, 6.0, 0.0),  # fixed take-profit
    (2.0, 0.0, 3.0),  # trailing stop
]

PERIOD_DAYS = 30
MIN_CANDLES = 120          # below this a 30d window is too sparse to trust
KEEP_PER_MARKET = 2        # cap per symbol+timeframe so one pair can't sweep the board
TOTAL_KEEP = 9             # size of the public board

_TF_MS = {"15m": 15 * 60_000, "1h": 60 * 60_000, "4h": 4 * 60 * 60_000, "1d": 24 * 60 * 60_000}


def _base_config(symbol: str, timeframe: str) -> dict[str, Any]:
    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "market": "spot",
        "direction": "long",
        "position_size_usdt": 100,
        "entry": [{"type": "ma_cross", "fast": 9, "slow": 21}],
        # RSI exit is a mild "take profit into overbought"; SL/TP/trailing do the rest.
        "exit": [{"type": "rsi", "op": ">", "value": 75}],
        "stop_loss": {"type": "pct", "value": 2.0},
        "take_profit": {"type": "pct", "value": 0.0},
        "trailing_stop": {"type": "pct", "value": 0.0},
        "filters": [],
    }


def _humanize(config: dict[str, Any]) -> tuple[str, str]:
    """Beginner-friendly RU title + subtitle — never raw indicator jargon."""
    entry = (config.get("entry") or [{}])[0]
    etype = entry.get("type", "ma_cross")
    entry_titles = {
        "ma_cross": "Тренд по скользящим",
        "ema_cross": "Тренд по EMA",
        "rsi": "Отскок по RSI",
        "breakout": "Пробой уровня",
        "macd": "Импульс MACD",
    }
    title = entry_titles.get(etype, "Стратегия")

    filters = config.get("filters") or []
    ftype = filters[0].get("type") if filters else None
    filter_notes = {
        "trend": "торгует только по тренду",
        "adx": "входит только в сильном движении",
        "volume": "ждёт всплеск объёма",
        "rsi": "отсекает перекупленность",
    }
    tp = float((config.get("take_profit") or {}).get("value") or 0)
    trail = float((config.get("trailing_stop") or {}).get("value") or 0)
    risk_note = "с трейлинг-стопом" if trail else "с фиксированным тейком" if tp else "держит до сигнала выхода"

    parts = [filter_notes[ftype]] if ftype in filter_notes else []
    parts.append(risk_note)
    subtitle = ", ".join(parts).capitalize()
    return title, subtitle


def _search(base: dict[str, Any], candles: list[list[float]]) -> list[dict[str, Any]]:
    """Every entry × filter × risk combination over one candle set, ranked by score.
    Pure CPU — call inside a thread."""
    out: list[dict[str, Any]] = []
    for entry_type in ENTRY_TYPES:
        for entry in _entry_variations(entry_type):
            for filt in _filter_candidates("long"):
                for sl, tp, trail in DISCOVERY_RISK:
                    cfg = copy.deepcopy(base)
                    cfg["entry"] = [entry]
                    cfg["filters"] = copy.deepcopy(filt)
                    cfg["stop_loss"] = {"type": "pct", "value": sl}
                    cfg["take_profit"] = {"type": "pct", "value": tp}
                    cfg["trailing_stop"] = {"type": "pct", "value": trail}
                    res = _simulate(cfg, candles, include_series=False)
                    n = _closed_trades(res)
                    row = {
                        "config": cfg,
                        "total_return_pct": res["total_return_pct"],
                        "max_drawdown_pct": res["max_drawdown_pct"],
                        "win_rate": res["win_rate"],
                        "trades": n,
                        "score": _score(res, n),
                    }
                    # Only advertise real, finite winners.
                    if _finite_result(row) and row["total_return_pct"] > 0:
                        out.append(row)
    out.sort(key=lambda r: r["score"], reverse=True)
    return out


def _period_days(candles: list[list[float]]) -> int:
    if len(candles) < 2:
        return PERIOD_DAYS
    span_ms = candles[-1][0] - candles[0][0]
    return max(1, round(span_ms / 86_400_000))


async def discover() -> list[dict[str, Any]]:
    """Run the full sweep and return the ranked, deduped top set (best first).
    Returns rows ready to persist as DiscoveredStrategy."""
    t0 = time.time()
    picks: list[dict[str, Any]] = []
    now_ms = int(time.time() * 1000)

    for symbol in DISCOVERY_SYMBOLS:
        for timeframe in DISCOVERY_TIMEFRAMES:
            base = _base_config(symbol, timeframe)
            since = now_ms - PERIOD_DAYS * 86_400_000
            # Room for the densest timeframe (15m over 30d ≈ 2880 candles).
            candles = await load_candles(base, since_ms=since, until_ms=None, limit=4000)
            if len(candles) < MIN_CANDLES:
                logger.info("discovery: %s %s only %d candles — skipped", symbol, timeframe, len(candles))
                continue
            ranked = await asyncio.to_thread(_search, base, candles)
            days = _period_days(candles)
            for row in ranked[:KEEP_PER_MARKET]:
                title, subtitle = _humanize(row["config"])
                picks.append({
                    "title": title,
                    "subtitle": subtitle,
                    "symbol": symbol,
                    "timeframe": timeframe,
                    "config_json": row["config"],
                    "total_return_pct": round(row["total_return_pct"], 2),
                    "max_drawdown_pct": round(row["max_drawdown_pct"], 2),
                    "win_rate": round(row["win_rate"], 2),
                    "trades": row["trades"],
                    "score": round(row["score"], 4),
                    "period_days": days,
                })

    picks.sort(key=lambda r: r["score"], reverse=True)
    top = picks[:TOTAL_KEEP]
    for i, row in enumerate(top):
        row["rank"] = i + 1
    logger.info("discovery: %d strategies from %d markets in %.0fs", len(top), len(DISCOVERY_SYMBOLS) * len(DISCOVERY_TIMEFRAMES), time.time() - t0)
    return top
