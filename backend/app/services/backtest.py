import asyncio
import copy
from typing import Any

from app.engine.risk import funding_cost, hedge_params, leverage, pct_value, round_trip_fee, trailing_pct
from app.engine.strategy_evaluator import build_signals, signal_at
from app.services.exchange import exchange_client


def _opposite(side: str) -> str:
    return "short" if side == "long" else "long"

# Most exchanges cap a single fetch_ohlcv call at ~1000 candles, so longer
# backtests are stitched together from several paginated requests.
MAX_CANDLES = 2000
PER_REQUEST_LIMIT = 1000


async def _fetch_candles(
    client,
    symbol: str,
    timeframe: str,
    since_ms: int | None = None,
    until_ms: int | None = None,
    limit: int = MAX_CANDLES,
) -> list[list[float]]:
    """Fetch up to `limit` OHLCV candles in [since_ms, until_ms], paginating around
    the exchange per-request cap. With no since_ms, returns the most recent `limit` candles."""
    tf_ms = client.parse_timeframe(timeframe) * 1000
    end = until_ms if until_ms is not None else client.milliseconds()
    cursor = since_ms if since_ms is not None else end - limit * tf_ms
    candles: list[list[float]] = []
    while len(candles) < limit:
        want = min(PER_REQUEST_LIMIT, limit - len(candles))
        batch = await client.fetch_ohlcv(
            symbol=symbol, timeframe=timeframe, since=cursor, limit=want
        )
        if not batch:
            break
        if candles:
            batch = [c for c in batch if c[0] > candles[-1][0]]
            if not batch:
                break
        batch = [c for c in batch if c[0] <= end]
        if not batch:
            break
        candles.extend(batch)
        if candles[-1][0] >= end - tf_ms:
            break
        cursor = candles[-1][0] + tf_ms
        # Don't stop just because a page came back shorter than requested: exchanges
        # cap page size and an unaligned `since` often returns one fewer candle.
        # Termination is handled above — reaching `end`, an empty page, or no new
        # candles (the dedup guard). Stopping on a short page truncated the no-date
        # backtest ~one page in (it ended ~10 days early instead of at "now").
    return candles[:limit]


async def load_candles(
    config: dict[str, Any],
    since_ms: int | None = None,
    until_ms: int | None = None,
    limit: int = MAX_CANDLES,
) -> list[list[float]]:
    """Fetch OHLCV candles for a strategy's symbol/timeframe in one network round-trip.

    Separated from the simulation so callers that test several configs over the same
    period (the optimizer, the AI analysis) fetch once and reuse, instead of opening a
    fresh client and re-fetching per config — repeated rapid fetches get throttled and
    come back empty, which silently produced 0-trade backtests."""
    symbol = config.get("symbol", "BTC/USDT")
    timeframe = config.get("timeframe", "1h")
    client = exchange_client()
    try:
        return await _fetch_candles(client, symbol, timeframe, since_ms, until_ms, limit=limit)
    finally:
        await client.close()


def simulate_backtest(
    config: dict[str, Any], candles: list[list[float]], include_series: bool = True
) -> dict[str, Any]:
    """Run a strategy over already-fetched candles (pure, no network)."""
    return _simulate(config, candles, include_series=include_series)


async def run_backtest(
    config: dict[str, Any],
    since_ms: int | None = None,
    until_ms: int | None = None,
) -> dict[str, Any]:
    candles = await load_candles(config, since_ms, until_ms)
    # Simulation is CPU-bound (hundreds of ms+); run it off the event loop so it
    # doesn't stall every other request while it crunches.
    return await asyncio.to_thread(_simulate, config, candles)


def _simulate(config: dict[str, Any], candles: list[list[float]], include_series: bool = True) -> dict[str, Any]:
    """Run the strategy over already-fetched candles. Pure/CPU-only so the
    optimizer can reuse one candle set across many parameter combinations.

    ``include_series`` controls whether the (heavier) price series + per-trade
    timestamps are built — the optimizer doesn't need them, so it passes False."""
    closes = [c[4] for c in candles]
    # Precompute every indicator once over the whole series (O(n)); the loop then
    # decides each bar with an array lookup instead of recomputing per bar (O(n²)).
    signals = build_signals(config, candles)
    lev = leverage(config)
    sl_val = pct_value(config.get("stop_loss"))
    tp_val = pct_value(config.get("take_profit"))
    trail_val = trailing_pct(config)
    hedge = hedge_params(config)  # None unless this is a futures strategy with hedging on
    fee = round_trip_fee(config)  # entry+exit taker fee, charged on every closed leg

    equity = 1000.0
    peak = equity
    side: str | None = None          # None | "long" | "short"
    entry: float | None = None
    entry_idx: int | None = None     # bar the position opened on, for funding cost
    extreme: float | None = None     # best price since entry, for the trailing stop
    hedge_side: str | None = None
    hedge_entry: float | None = None
    hedge_extreme: float | None = None
    trades: list[dict[str, Any]] = []
    curve: list[dict[str, float]] = []
    wins = 0
    loss = 0

    def realize(ret: float) -> None:
        """Compound a fractional return into equity, amplified by leverage."""
        nonlocal equity
        equity *= 1 + ret * lev

    def main_ret(open_side: str, exit_price: float, entry_price: float) -> float:
        return (exit_price - entry_price) / entry_price if open_side == "long" else (entry_price - exit_price) / entry_price

    for idx, candle in enumerate(candles):
        # candle = [ts, open, high, low, close, volume]
        open_, high, low, close = candle[1], candle[2], candle[3], candle[4]
        sig = signal_at(signals, idx, side)

        if side is None:
            if sig in ("long", "short"):
                side = sig
                entry = close
                entry_idx = idx
                extreme = close
                trades.append({"side": sig, "price": close, "index": idx, "leg": "main"})
                if hedge and hedge["mode"] == "constant_partial":
                    hedge_side = _opposite(sig)
                    hedge_entry = close
                    trades.append({"side": hedge_side, "price": close, "index": idx, "leg": "hedge"})
        else:
            # 1. Release an auto_squeeze hedge once price recovers far enough off its extreme.
            if hedge and hedge["mode"] == "auto_squeeze" and hedge_entry is not None:
                if side == "long":
                    hedge_extreme = min(hedge_extreme if hedge_extreme is not None else low, low)
                    release_price = hedge_extreme * (1 + hedge["release_pct"] / 100)
                    released = high >= release_price
                else:
                    hedge_extreme = max(hedge_extreme if hedge_extreme is not None else high, high)
                    release_price = hedge_extreme * (1 - hedge["release_pct"] / 100)
                    released = low <= release_price
                if released:
                    hret = (release_price - hedge_entry) / hedge_entry if hedge_side == "long" else (hedge_entry - release_price) / hedge_entry
                    hnet = hret - fee
                    realize(hedge["ratio"] * hnet)
                    trades.append({
                        "side": "buy" if hedge_side == "short" else "sell", "price": release_price,
                        "index": idx, "leg": "hedge", "pnl_pct": hnet * 100, "reason": "recovered",
                    })
                    hedge_side = hedge_entry = hedge_extreme = None

            # 2. Exit the main position: stop-loss, then trailing stop, then take-profit, then signal/flip.
            #    (gap-aware fills; the trailing extreme is updated with this candle first.)
            exit_price: float | None = None
            reason: str | None = None
            if side == "long":
                extreme = max(extreme if extreme is not None else high, high)
                if sl_val is not None and low <= entry * (1 - sl_val / 100):
                    exit_price = min(entry * (1 - sl_val / 100), open_)  # gap-down fills at the open
                    reason = "stop_loss"
                elif trail_val is not None and low <= extreme * (1 - trail_val / 100):
                    # Trail level is set intrabar (after the open), so fill at the level,
                    # bounded by the candle high (covers a gap-down through the level).
                    exit_price = min(extreme * (1 - trail_val / 100), high)
                    reason = "trailing_stop"
                elif tp_val is not None and high >= entry * (1 + tp_val / 100):
                    exit_price = entry * (1 + tp_val / 100)
                    reason = "take_profit"
            else:  # short
                extreme = min(extreme if extreme is not None else low, low)
                if sl_val is not None and high >= entry * (1 + sl_val / 100):
                    exit_price = max(entry * (1 + sl_val / 100), open_)  # gap-up fills at the open
                    reason = "stop_loss"
                elif trail_val is not None and high >= extreme * (1 + trail_val / 100):
                    exit_price = max(extreme * (1 + trail_val / 100), low)
                    reason = "trailing_stop"
                elif tp_val is not None and low <= entry * (1 - tp_val / 100):
                    exit_price = entry * (1 - tp_val / 100)
                    reason = "take_profit"
            if exit_price is None:
                if sig == "close":
                    exit_price, reason = close, "signal"
                elif sig in ("long", "short") and sig != side:
                    exit_price, reason = close, "flip"

            if exit_price is not None:
                ret = main_ret(side, exit_price, entry)
                # Net of round-trip taker fee and (futures) funding over the hold.
                net = ret - fee - funding_cost(config, idx - (entry_idx or idx))
                realize(net)
                wins += net > 0
                loss += net <= 0
                trades.append({
                    "side": "sell" if side == "long" else "buy", "price": exit_price,
                    "index": idx, "leg": "main", "pnl_pct": net * 100, "reason": reason,
                })
                # Unwind any hedge alongside the main position.
                if hedge and hedge_entry is not None:
                    hret = (exit_price - hedge_entry) / hedge_entry if hedge_side == "long" else (hedge_entry - exit_price) / hedge_entry
                    hnet = hret - fee
                    realize(hedge["ratio"] * hnet)
                    trades.append({
                        "side": "buy" if hedge_side == "short" else "sell", "price": exit_price,
                        "index": idx, "leg": "hedge", "pnl_pct": hnet * 100, "reason": "position_closed",
                    })
                    hedge_side = hedge_entry = hedge_extreme = None
                side = entry = entry_idx = extreme = None
            elif hedge and hedge["mode"] == "auto_squeeze" and hedge_entry is None and high > 0 and low > 0:
                # Still holding: open a hedge if this candle shows a fast adverse intrabar move.
                if side == "long" and (high - low) / high * 100 >= hedge["trigger_pct"]:
                    hedge_side, hedge_entry, hedge_extreme = "short", high * (1 - hedge["trigger_pct"] / 100), low
                    trades.append({"side": "sell", "price": hedge_entry, "index": idx, "leg": "hedge", "reason": "squeeze"})
                elif side == "short" and (high - low) / low * 100 >= hedge["trigger_pct"]:
                    hedge_side, hedge_entry, hedge_extreme = "long", low * (1 + hedge["trigger_pct"] / 100), high
                    trades.append({"side": "buy", "price": hedge_entry, "index": idx, "leg": "hedge", "reason": "squeeze"})

        peak = max(peak, equity)
        drawdown = ((peak - equity) / peak) * 100 if peak else 0.0
        # x is the candle's real open time (seconds) so the chart shows true dates.
        curve.append({"x": float(candle[0]) / 1000.0, "y": float(equity), "dd": float(drawdown)})

    price_series: list[dict[str, float]] = []
    if include_series:
        price_series = [
            {"x": float(c[0]) / 1000.0, "o": float(c[1]), "h": float(c[2]), "l": float(c[3]), "c": float(c[4])}
            for c in candles
        ]
        # Stamp each trade with its candle's open time so the chart can place a
        # marker at the exact bar where the trade happened.
        for t in trades:
            i = t.get("index")
            if isinstance(i, int) and 0 <= i < len(candles):
                t["time"] = float(candles[i][0]) / 1000.0

    total_trades = max(wins + loss, 1)
    return {
        "total_return_pct": (equity - 1000.0) / 1000.0 * 100,
        "max_drawdown_pct": max((p["dd"] for p in curve), default=0.0),
        "win_rate": wins / total_trades * 100,
        "trades": trades,
        "equity_curve": [{"x": p["x"], "y": p["y"]} for p in curve],
        "price_series": price_series,
        "candles": len(candles),
        "start": (float(candles[0][0]) / 1000.0) if candles else None,
        "end": (float(candles[-1][0]) / 1000.0) if candles else None,
    }


# ---- optimizer (parameter sweep) -------------------------------------------

OPTIMIZE_CANDLES = 800
OPTIMIZE_MIN_TRADES = 5
OPTIMIZE_TOP_N = 12

# Curated risk profiles: (stop_loss, take_profit, trailing_stop) in percent; 0 = off.
_RISK_PROFILES = [
    (2.0, 5.0, 0.0),   # fixed take-profit
    (2.0, 0.0, 4.0),   # let it run on a trailing stop
    (1.5, 3.0, 0.0),   # tight scalp
]

# Entry-filter options to try: none, trade-with-the-trend, or trend-strength (ADX).
_FILTER_SETS: list[list[dict[str, Any]]] = [
    [],
    [{"type": "trend", "ma": "ema", "period": 200}],
    [{"type": "trend", "ma": "ema", "period": 50}],
    [{"type": "adx", "period": 14, "min": 20}],
]


def _entry_variations(entry_type: str) -> list[dict[str, Any]]:
    if entry_type in ("ma_cross", "ema_cross"):
        return [
            {"type": entry_type, "fast": f, "slow": s}
            for f in (5, 9, 20) for s in (21, 50) if f < s
        ]
    if entry_type == "rsi":
        return [
            {"type": "rsi", "period": 14, "low": lo, "high": hi}
            for lo in (20, 25, 30) for hi in (70, 75, 80)
        ]
    if entry_type == "breakout":
        return [{"type": "breakout", "period": p} for p in (10, 20, 30, 55)]
    if entry_type == "macd":
        return [{"type": "macd", "fast": f, "slow": s, "signal": 9} for f, s in ((12, 26), (8, 21), (5, 35))]
    return [{"type": entry_type}]


def _param_grid(base: dict[str, Any]) -> list[dict[str, Any]]:
    entry_type = (base.get("entry") or [{}])[0].get("type", "ma_cross")
    grid: list[dict[str, Any]] = []
    for entry in _entry_variations(entry_type):
        for sl, tp, trail in _RISK_PROFILES:
            for filters in _FILTER_SETS:
                cfg = copy.deepcopy(base)
                cfg["entry"] = [entry]
                cfg["stop_loss"] = {"type": "pct", "value": sl}
                cfg["take_profit"] = {"type": "pct", "value": tp}
                cfg["trailing_stop"] = {"type": "pct", "value": trail}
                cfg["filters"] = copy.deepcopy(filters)
                grid.append(cfg)
    return grid


def _closed_trades(result: dict[str, Any]) -> int:
    return sum(1 for t in result["trades"] if t.get("leg") == "main" and "pnl_pct" in t)


def _score(result: dict[str, Any], n_trades: int) -> float:
    """Risk-adjusted: return per unit of drawdown. Configs with too few trades
    are pushed to the bottom so a single lucky trade can't top the board."""
    if n_trades < OPTIMIZE_MIN_TRADES:
        return float("-inf")
    return result["total_return_pct"] / max(result["max_drawdown_pct"], 1.0)


def _run_grid(config: dict[str, Any], candles: list[list[float]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for cfg in _param_grid(config):
        res = _simulate(cfg, candles, include_series=False)
        n = _closed_trades(res)
        out.append({
            "config": cfg,
            "total_return_pct": res["total_return_pct"],
            "max_drawdown_pct": res["max_drawdown_pct"],
            "win_rate": res["win_rate"],
            "trades": n,
            "score": _score(res, n),
        })
    out.sort(key=lambda r: r["score"], reverse=True)
    return out


async def run_optimization(
    config: dict[str, Any], since_ms: int | None = None, until_ms: int | None = None
) -> dict[str, Any]:
    """Sweep parameter combinations over one candle set and rank by a
    risk-adjusted score. CPU work runs in a thread so the event loop stays free."""
    candles = await load_candles(config, since_ms, until_ms, limit=OPTIMIZE_CANDLES)
    results = await asyncio.to_thread(_run_grid, config, candles)
    ranked = [r for r in results if r["score"] != float("-inf")] or results
    return {"results": ranked[:OPTIMIZE_TOP_N], "tested": len(results), "candles": len(candles)}


# ---- walk-forward (out-of-sample) validation -------------------------------


def _describe_config(cfg: dict[str, Any]) -> str:
    e = (cfg.get("entry") or [{}])[0]
    t = e.get("type", "?")
    if t in ("ma_cross", "ema_cross"):
        s = f"{t} {e.get('fast')}/{e.get('slow')}"
    elif t == "rsi":
        s = f"rsi {e.get('low')}/{e.get('high')}"
    elif t == "breakout":
        s = f"breakout {e.get('period')}"
    elif t == "macd":
        s = f"macd {e.get('fast')}/{e.get('slow')}"
    else:
        s = str(t)
    sl = (cfg.get("stop_loss") or {}).get("value")
    tp = (cfg.get("take_profit") or {}).get("value")
    tr = (cfg.get("trailing_stop") or {}).get("value")
    s += f" · SL{sl}/TP{tp}" + (f"/Tr{tr}" if tr else "")
    if cfg.get("filters"):
        s += " +filter"
    return s


def run_walkforward(config: dict[str, Any], candles: list[list[float]]) -> dict[str, Any]:
    """Rolling out-of-sample test. For each window: optimise on the training slice,
    then measure that winning config on the *next, unseen* slice. The stitched
    out-of-sample result is the realistic expectation; a big gap vs the in-sample
    numbers means the optimisation was overfit."""
    n = len(candles)
    test_size = min(300, max(120, n // 8))
    train_size = min(800, max(300, n // 3))

    folds: list[dict[str, Any]] = []
    start = 0
    while start + train_size + test_size <= n:
        train = candles[start : start + train_size]
        test = candles[start + train_size : start + train_size + test_size]
        ranked = _run_grid(config, train)
        pool = [r for r in ranked if r["score"] != float("-inf")] or ranked
        if not pool:
            break
        best = pool[0]
        oos = _simulate(best["config"], test, include_series=False)
        folds.append({
            "n": len(folds) + 1,
            "in_return_pct": round(best["total_return_pct"], 2),
            "out_return_pct": round(oos["total_return_pct"], 2),
            "out_drawdown_pct": round(oos["max_drawdown_pct"], 2),
            "out_trades": _closed_trades(oos),
            "summary": _describe_config(best["config"]),
        })
        start += test_size

    empty = {
        "folds": [], "avg_in_return_pct": 0.0, "avg_out_return_pct": 0.0,
        "combined_out_return_pct": 0.0, "profitable_folds": 0, "total_folds": len(folds), "candles": n,
    }
    if len(folds) < 2:
        return {**empty, "verdict": "insufficient",
                "message": "Мало истории для walk-forward — выбери период подлиннее или таймфрейм помельче."}

    total = len(folds)
    avg_in = round(sum(f["in_return_pct"] for f in folds) / total, 2)
    avg_out = round(sum(f["out_return_pct"] for f in folds) / total, 2)
    compounded = 1.0
    for f in folds:
        compounded *= 1 + f["out_return_pct"] / 100
    combined_out = round((compounded - 1) * 100, 2)
    profitable = sum(1 for f in folds if f["out_return_pct"] > 0)

    if combined_out > 0 and profitable / total >= 0.5:
        verdict = "robust"
        message = (f"Похоже на реальный эдж: на новых данных суммарно {combined_out:+.1f}%, "
                   f"прибыльных окон {profitable} из {total}.")
    elif combined_out <= 0:
        verdict = "overfit"
        message = (f"Переподгонка: на обучении в среднем {avg_in:+.1f}%, а на новых данных суммарно "
                   f"{combined_out:+.1f}%. В реальной торговле такой подбор, скорее всего, сольёт.")
    else:
        verdict = "mixed"
        message = (f"Неустойчиво: на новых данных суммарно {combined_out:+.1f}%, но прибыльных окон "
                   f"лишь {profitable} из {total} — результат держится на отдельных периодах.")

    return {
        "verdict": verdict, "message": message, "folds": folds,
        "avg_in_return_pct": avg_in, "avg_out_return_pct": avg_out,
        "combined_out_return_pct": combined_out, "profitable_folds": profitable,
        "total_folds": total, "candles": n,
    }
