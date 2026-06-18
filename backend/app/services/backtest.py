import asyncio
import copy
import math
import random
from typing import Any

from app.engine.risk import funding_cost, hedge_params, leverage, pct_value, round_trip_fee, trailing_pct
from app.engine.strategy_evaluator import build_signals, signal_at
from app.services import candle_store
from app.services.exchange import exchange_client
from app.services.indicators import atr_series


def _opposite(side: str) -> str:
    return "short" if side == "long" else "long"


# Fixed seed for the Monte-Carlo bootstrap so a backtest is reproducible.
_MC_SEED = 12345


_PERIODS_PER_YEAR = {"5m": 105120, "15m": 35040, "1h": 8760, "4h": 2190, "1d": 365}


def _extended_metrics(
    eq: list[float], trade_returns: list[float], timeframe: str, bars_in_pos: int, n_bars: int,
    max_dd_pct: float, start_s: float | None, end_s: float | None,
) -> dict[str, float]:
    """Risk-adjusted stats from the equity curve + per-trade returns: Sharpe,
    Sortino, Calmar, profit factor, expectancy, exposure, annualised return."""
    ppy = _PERIODS_PER_YEAR.get(timeframe, 8760)
    bar_rets = [eq[i] / eq[i - 1] - 1 for i in range(1, len(eq)) if eq[i - 1]]
    sharpe = sortino = 0.0
    if len(bar_rets) > 1:
        mean = sum(bar_rets) / len(bar_rets)
        var = sum((r - mean) ** 2 for r in bar_rets) / len(bar_rets)
        sd = math.sqrt(var)
        if sd > 0:
            sharpe = mean / sd * math.sqrt(ppy)
        downs = [r for r in bar_rets if r < 0]
        if len(downs) > 1:
            dvar = sum(r * r for r in downs) / len(downs)
            dsd = math.sqrt(dvar)
            if dsd > 0:
                sortino = mean / dsd * math.sqrt(ppy)

    final = eq[-1] if eq else 1000.0
    years = (end_s - start_s) / (365 * 24 * 3600) if (start_s and end_s and end_s > start_s) else (n_bars / ppy)
    years = max(years, 1e-9)
    ann_return = ((final / 1000.0) ** (1 / years) - 1) * 100 if final > 0 else -100.0
    calmar = ann_return / max_dd_pct if max_dd_pct > 0.01 else 0.0

    gross_win = sum(r for r in trade_returns if r > 0)
    gross_loss = -sum(r for r in trade_returns if r < 0)
    profit_factor = round(min(gross_win / gross_loss, 99.0), 2) if gross_loss > 1e-9 else (99.0 if gross_win > 0 else 0.0)
    expectancy = (sum(trade_returns) / len(trade_returns) * 100) if trade_returns else 0.0
    exposure = (bars_in_pos / n_bars * 100) if n_bars else 0.0
    return {
        "sharpe": round(sharpe, 2),
        "sortino": round(sortino, 2),
        "calmar": round(calmar, 2),
        "profit_factor": profit_factor,
        "expectancy_pct": round(expectancy, 3),
        "exposure_pct": round(exposure, 1),
        "ann_return_pct": round(ann_return, 2),
    }


def _monte_carlo(trade_returns: list[float], sims: int = 1000) -> dict[str, Any] | None:
    """Bootstrap the trade returns to see how lucky the result was: resample the
    trades (with replacement) many times and report the spread of final returns and
    drawdowns. A 5th percentile still in profit = robust; a wide, mostly-negative
    spread = the headline number leaned on luck."""
    n = len(trade_returns)
    if n < 8:
        return None
    # Local seeded RNG: the bootstrap stays reproducible (same trades -> same
    # numbers on every run) without disturbing the global random stream.
    rng = random.Random(_MC_SEED)
    finals: list[float] = []
    maxdds: list[float] = []
    for _ in range(sims):
        eq = 1.0
        peak = 1.0
        mdd = 0.0
        for _ in range(n):
            eq *= 1 + trade_returns[rng.randrange(n)]
            if eq <= 0:
                eq = 1e-9
            peak = max(peak, eq)
            mdd = max(mdd, (peak - eq) / peak)
        finals.append((eq - 1) * 100)
        maxdds.append(mdd * 100)
    finals.sort()
    maxdds.sort()

    def q(arr: list[float], p: float) -> float:
        return arr[min(len(arr) - 1, int(p * len(arr)))]

    return {
        "simulations": sims,
        "median_return_pct": round(q(finals, 0.5), 2),
        "p5_return_pct": round(q(finals, 0.05), 2),
        "p95_return_pct": round(q(finals, 0.95), 2),
        "prob_profit_pct": round(sum(1 for f in finals if f > 0) / sims * 100, 1),
        "median_maxdd_pct": round(q(maxdds, 0.5), 2),
        "p95_maxdd_pct": round(q(maxdds, 0.95), 2),
    }

# Most exchanges cap a single fetch_ohlcv call at ~1000 candles, so longer
# backtests are stitched together from several paginated requests.
MAX_CANDLES = 2000
PER_REQUEST_LIMIT = 1000
# When a date range is given the cache can serve years; cap the run and downsample
# the chart series so the response stays small.
MAX_DATED_CANDLES = 60000
MAX_SERIES_POINTS = 2500
# Walk-forward spans more history than a single backtest (many regimes), but is
# capped so the multiple optimiser sweeps finish in well under the request timeout.
WALKFORWARD_CANDLES = 12000
# Candles fed in before each out-of-sample window purely to warm the indicators
# (covers up to a 200-period filter); no trades are taken during them.
WALKFORWARD_WARMUP = 250


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
    # Prefer the local cache (instant, spans years); fall back to a live fetch when
    # it's empty for this symbol/timeframe (e.g. backfill still running).
    if candle_store.is_ready():
        cached = await asyncio.to_thread(candle_store.get_candles, symbol, timeframe, since_ms, until_ms, limit)
        if cached:
            return cached
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
    # With a date range the cache can serve years; without one keep the recent
    # window. Either way the simulation runs off the event loop (CPU-bound).
    limit = MAX_DATED_CANDLES if (since_ms is not None or until_ms is not None) else MAX_CANDLES
    candles = await load_candles(config, since_ms, until_ms, limit=limit)
    return await asyncio.to_thread(_simulate, config, candles)


def _simulate(
    config: dict[str, Any], candles: list[list[float]], include_series: bool = True, warmup: int = 0
) -> dict[str, Any]:
    """Run the strategy over already-fetched candles. Pure/CPU-only so the
    optimizer can reuse one candle set across many parameter combinations.

    ``include_series`` controls whether the (heavier) price series + per-trade
    timestamps are built — the optimizer doesn't need them, so it passes False.

    ``warmup`` bars at the front are used only to warm the indicators (computed
    over the whole slice): no position is opened and nothing is counted there, so
    the result reflects only candles[warmup:]. Walk-forward uses this so a
    long-period filter doesn't start cold (and trade-free) on each test window."""
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

    # Volatility targeting (optional): scale each position so risk per trade stays
    # even — smaller in volatile periods, larger in calm ones. 0 = off (fixed size).
    vol_target = float(config.get("vol_target_pct") or 0)
    atr_pct: list[float] = []
    if vol_target > 0:
        highs = [c[2] for c in candles]
        lows = [c[3] for c in candles]
        arr = atr_series(highs, lows, closes, 14)
        atr_pct = [
            (float(a) / closes[i] * 100) if (a == a and closes[i]) else 0.0  # a==a skips NaN
            for i, a in enumerate(arr)
        ]

    def _size_mult(idx: int) -> float:
        if vol_target <= 0 or idx >= len(atr_pct) or atr_pct[idx] <= 0:
            return 1.0
        return max(0.25, min(3.0, vol_target / atr_pct[idx]))

    equity = 1000.0
    peak = equity
    side: str | None = None          # None | "long" | "short"
    entry: float | None = None
    entry_idx: int | None = None     # bar the position opened on, for funding cost
    extreme: float | None = None     # best price since entry, for the trailing stop
    pos_mult = 1.0                   # size multiplier locked in at entry (vol targeting)
    hedge_side: str | None = None
    hedge_entry: float | None = None
    hedge_extreme: float | None = None
    trades: list[dict[str, Any]] = []
    curve: list[dict[str, float]] = []
    trade_returns: list[float] = []  # net fractional return per closed main trade (for metrics/MC)
    bars_in_pos = 0
    wins = 0
    loss = 0

    def realize(ret: float, mult: float = 1.0) -> None:
        """Compound a fractional return into equity, amplified by leverage (and the
        position's volatility-sizing multiplier)."""
        nonlocal equity
        equity *= 1 + ret * lev * mult

    def main_ret(open_side: str, exit_price: float, entry_price: float) -> float:
        return (exit_price - entry_price) / entry_price if open_side == "long" else (entry_price - exit_price) / entry_price

    for idx, candle in enumerate(candles):
        # Warmup bars only prime the indicators (already computed over the whole
        # slice); take no trades and record no equity until the real window starts.
        if idx < warmup:
            continue
        # candle = [ts, open, high, low, close, volume]
        open_, high, low, close = candle[1], candle[2], candle[3], candle[4]
        sig = signal_at(signals, idx, side)

        if side is None:
            if sig in ("long", "short"):
                side = sig
                entry = close
                entry_idx = idx
                extreme = close
                pos_mult = _size_mult(idx)
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
                realize(net, pos_mult)
                trade_returns.append(net * lev * pos_mult)
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
                pos_mult = 1.0
            elif hedge and hedge["mode"] == "auto_squeeze" and hedge_entry is None and high > 0 and low > 0:
                # Still holding: open a hedge if this candle shows a fast adverse intrabar move.
                if side == "long" and (high - low) / high * 100 >= hedge["trigger_pct"]:
                    hedge_side, hedge_entry, hedge_extreme = "short", high * (1 - hedge["trigger_pct"] / 100), low
                    trades.append({"side": "sell", "price": hedge_entry, "index": idx, "leg": "hedge", "reason": "squeeze"})
                elif side == "short" and (high - low) / low * 100 >= hedge["trigger_pct"]:
                    hedge_side, hedge_entry, hedge_extreme = "long", low * (1 + hedge["trigger_pct"] / 100), high
                    trades.append({"side": "buy", "price": hedge_entry, "index": idx, "leg": "hedge", "reason": "squeeze"})

        if side is not None:
            bars_in_pos += 1
        peak = max(peak, equity)
        drawdown = ((peak - equity) / peak) * 100 if peak else 0.0
        # x is the candle's real open time (seconds) so the chart shows true dates.
        curve.append({"x": float(candle[0]) / 1000.0, "y": float(equity), "dd": float(drawdown)})

    price_series: list[dict[str, float]] = []
    equity_curve = [{"x": p["x"], "y": p["y"]} for p in curve]
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
        # Multi-year runs have tens of thousands of points; thin the chart series
        # (every k-th bar) so the response stays light. Metrics use the full data.
        if len(candles) > MAX_SERIES_POINTS:
            step = len(candles) // MAX_SERIES_POINTS + 1
            price_series = price_series[::step]
            equity_curve = equity_curve[::step]

    # Everything below reflects only the measured window (candles after warmup).
    eff = candles[warmup:] if warmup else candles
    total_trades = max(wins + loss, 1)
    max_dd = max((p["dd"] for p in curve), default=0.0)
    start_s = (float(eff[0][0]) / 1000.0) if eff else None
    end_s = (float(eff[-1][0]) / 1000.0) if eff else None
    result: dict[str, Any] = {
        "total_return_pct": (equity - 1000.0) / 1000.0 * 100,
        "max_drawdown_pct": max_dd,
        "win_rate": wins / total_trades * 100,
        "trades": trades,
        "equity_curve": equity_curve,
        "price_series": price_series,
        "candles": len(eff),
        "start": start_s,
        "end": end_s,
    }
    # Risk-adjusted metrics + a Monte-Carlo robustness check are only needed for the
    # user-facing run (include_series), not the optimizer's thousands of sweeps.
    if include_series:
        result["metrics"] = _extended_metrics(
            [p["y"] for p in curve], trade_returns, config.get("timeframe", "1h"),
            bars_in_pos, len(eff), max_dd, start_s, end_s,
        )
        result["monte_carlo"] = _monte_carlo(trade_returns)
    return result


# ---- optimizer (parameter sweep) -------------------------------------------

OPTIMIZE_CANDLES = 800
OPTIMIZE_MIN_TRADES = 5
OPTIMIZE_TOP_N = 12

# The optimiser tunes ONE group at a time, holding the rest of the strategy at
# its current values, so each concern is optimised in isolation.
OPTIMIZE_GROUPS = frozenset({"entry", "exits", "long_filters", "short_filters"})

# SL / TP / trailing combinations (percent; 0 = off) for the "exits" group.
_RISK_GRID = [
    (sl, tp, trail)
    for sl in (1.5, 2.0, 3.0, 5.0)
    for tp in (0.0, 3.0, 5.0, 8.0)
    for trail in (0.0, 2.0, 4.0)
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


def _filter_candidates(side: str) -> list[list[dict[str, Any]]]:
    """Per-side filter options to try for one direction. Each option is a (possibly
    empty) filter list already tagged with ``side`` so it only gates that side."""
    opts: list[list[dict[str, Any]]] = [
        [],
        [{"type": "trend", "ma": "ema", "period": 200}],
        [{"type": "trend", "ma": "ema", "period": 50}],
        [{"type": "adx", "period": 14, "min": 20}],
        [{"type": "adx", "period": 14, "min": 25}],
        [{"type": "volume", "period": 20, "mult": 1.5}],
        # RSI: only the bound that applies to this side (skip overbought longs /
        # oversold shorts) so the description stays honest.
        [{"type": "rsi", "period": 14, "max": 70}] if side == "long" else [{"type": "rsi", "period": 14, "min": 30}],
    ]
    for opt in opts:
        for f in opt:
            f["side"] = side
    return opts


def _param_grid(base: dict[str, Any], group: str) -> list[dict[str, Any]]:
    """Configs to try for ONE optimisation group, holding everything else at the
    base strategy's current values (so each concern is tuned in isolation)."""
    grid: list[dict[str, Any]] = []
    if group == "entry":
        entry_type = (base.get("entry") or [{}])[0].get("type", "ma_cross")
        for entry in _entry_variations(entry_type):
            cfg = copy.deepcopy(base)
            cfg["entry"] = [entry]
            grid.append(cfg)
    elif group == "exits":
        for sl, tp, trail in _RISK_GRID:
            cfg = copy.deepcopy(base)
            cfg["stop_loss"] = {"type": "pct", "value": sl}
            cfg["take_profit"] = {"type": "pct", "value": tp}
            cfg["trailing_stop"] = {"type": "pct", "value": trail}
            grid.append(cfg)
    elif group in ("long_filters", "short_filters"):
        side = "long" if group == "long_filters" else "short"
        # Keep the base's other-side and both-side filters; swap only this side's.
        kept = [f for f in (base.get("filters") or []) if isinstance(f, dict) and f.get("side", "both") != side]
        for cand in _filter_candidates(side):
            cfg = copy.deepcopy(base)
            cfg["filters"] = copy.deepcopy(kept) + copy.deepcopy(cand)
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


def _run_grid(config: dict[str, Any], candles: list[list[float]], group: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for cfg in _param_grid(config, group):
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
    config: dict[str, Any], group: str = "entry", since_ms: int | None = None, until_ms: int | None = None
) -> dict[str, Any]:
    """Sweep ONE group's options (entry / exits / long_filters / short_filters)
    over a candle set and rank by a risk-adjusted score, holding the rest of the
    strategy fixed. CPU work runs in a thread so the event loop stays free."""
    if group not in OPTIMIZE_GROUPS:
        group = "entry"
    candles = await load_candles(config, since_ms, until_ms, limit=OPTIMIZE_CANDLES)
    results = await asyncio.to_thread(_run_grid, config, candles, group)
    ranked = [r for r in results if r["score"] != float("-inf")] or results
    return {"results": ranked[:OPTIMIZE_TOP_N], "tested": len(results), "candles": len(candles), "group": group}


# ---- parameter sensitivity (overfit detection) -----------------------------


def _sens_axes(config: dict[str, Any]):
    """Two parameters to sweep around their current values, by entry type."""
    e = (config.get("entry") or [{}])[0]
    t = e.get("type", "ma_cross")

    def ints(v: float, lo: int = 1) -> list[float]:
        return sorted({float(max(lo, int(round(v * f)))) for f in (0.5, 0.75, 1.0, 1.25, 1.5)})

    def pcts(v: float, lo: float = 0.1) -> list[float]:
        return sorted({round(max(lo, v * f), 1) for f in (0.5, 0.75, 1.0, 1.25, 1.5)})

    if t in ("ma_cross", "ema_cross", "macd"):
        fast, slow = float(e.get("fast", 9)), float(e.get("slow", 21))
        return ("Fast", lambda c, v: c["entry"][0].__setitem__("fast", int(v)), ints(fast), fast,
                "Slow", lambda c, v: c["entry"][0].__setitem__("slow", int(v)), ints(slow), slow)
    if t == "rsi":
        lo, hi = float(e.get("low", 30)), float(e.get("high", 70))
        return ("Oversold", lambda c, v: c["entry"][0].__setitem__("low", v), pcts(lo), lo,
                "Overbought", lambda c, v: c["entry"][0].__setitem__("high", v), pcts(hi), hi)
    if t == "breakout":
        per = float(e.get("period", 20))
        sl = pct_value(config.get("stop_loss")) or 2.0
        return ("Lookback", lambda c, v: c["entry"][0].__setitem__("period", int(v)), ints(per), per,
                "Stop %", lambda c, v: c.__setitem__("stop_loss", {"type": "pct", "value": v}), pcts(sl), sl)
    sl = pct_value(config.get("stop_loss")) or 2.0
    tp = pct_value(config.get("take_profit")) or 4.0
    return ("Stop %", lambda c, v: c.__setitem__("stop_loss", {"type": "pct", "value": v}), pcts(sl), sl,
            "Take %", lambda c, v: c.__setitem__("take_profit", {"type": "pct", "value": v}), pcts(tp), tp)


def run_sensitivity(config: dict[str, Any], candles: list[list[float]]) -> dict[str, Any]:
    """Sweep two parameters around their current values and report the return at
    each combination. A broad green region = robust; a lone bright cell = overfit."""
    x_label, set_x, xs, cur_x, y_label, set_y, ys, cur_y = _sens_axes(config)
    grid: list[list[float]] = []
    for yv in ys:
        row: list[float] = []
        for xv in xs:
            c = copy.deepcopy(config)
            set_x(c, xv)
            set_y(c, yv)
            res = _simulate(c, candles, include_series=False)
            row.append(round(res["total_return_pct"], 2))
        grid.append(row)

    flat = [v for row in grid for v in row]
    profitable = sum(1 for v in flat if v > 0)
    total = len(flat) or 1
    frac = profitable / total
    if frac >= 0.7:
        verdict = "robust"
        message = f"Стабильно: прибыльны {profitable} из {total} соседних наборов — широкое плато, а не одиночный пик."
    elif frac >= 0.4:
        verdict = "mixed"
        message = f"Средне: прибыльны {profitable} из {total} наборов — результат заметно зависит от параметров."
    else:
        verdict = "fragile"
        message = f"Хрупко: прибыльны лишь {profitable} из {total} наборов — похоже на переподгонку под конкретные значения."
    return {
        "x_label": x_label, "y_label": y_label, "x_values": xs, "y_values": ys,
        "grid": grid, "cur_x": cur_x, "cur_y": cur_y, "verdict": verdict, "message": message,
    }


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
    """Roll the user's own strategy across sequential time windows (no re-optimising).

    Each window runs *this exact config* on a different stretch of history, so the
    table answers the real question: is the overall return spread across most
    periods (a consistent edge), or did it come from one or two lucky windows?
    Indicators are warmed on the candles right before each window, so a long-period
    filter is never cold. Compounding the windows ≈ the full backtest return."""
    n = len(candles)
    warm = min(WALKFORWARD_WARMUP, n // 4)
    usable = n - warm
    min_window = 150  # need enough candles per window for a few trades
    # Aim for ~10 windows, but never so many that each is too short to be meaningful.
    k = min(10, usable // min_window)

    empty = {
        "folds": [], "avg_return_pct": 0.0, "combined_return_pct": 0.0,
        "profitable_folds": 0, "total_folds": 0, "candles": n,
    }
    if k < 2:
        return {**empty, "verdict": "insufficient",
                "message": "Мало истории для walk-forward — выбери период подлиннее или таймфрейм помельче."}

    window = usable // k
    folds: list[dict[str, Any]] = []
    start = warm
    for i in range(k):
        # The last window absorbs any remainder so all history is used.
        end = n if i == k - 1 else start + window
        seg = candles[start - warm : end]
        res = _simulate(config, seg, include_series=False, warmup=warm)
        folds.append({
            "n": i + 1,
            "return_pct": round(res["total_return_pct"], 2),
            "drawdown_pct": round(res["max_drawdown_pct"], 2),
            "trades": _closed_trades(res),
            "start": res["start"],
            "end": res["end"],
        })
        start = end

    total = len(folds)
    avg_return = round(sum(f["return_pct"] for f in folds) / total, 2)
    compounded = 1.0
    for f in folds:
        compounded *= 1 + f["return_pct"] / 100
    combined = round((compounded - 1) * 100, 2)
    profitable = sum(1 for f in folds if f["return_pct"] > 0)
    frac = profitable / total

    if frac >= 0.6 and combined > 0:
        verdict = "robust"
        message = (f"Стабильно: твоя стратегия в плюсе в {profitable} из {total} периодов, суммарно "
                   f"{combined:+.1f}%. Похоже на устойчивый эдж, а не один удачный отрезок.")
    elif frac >= 0.4:
        verdict = "mixed"
        message = (f"Неравномерно: прибыльных {profitable} из {total} периодов, суммарно {combined:+.1f}%. "
                   f"Эдж есть, но заметно зависит от рынка — держись скромного плеча.")
    else:
        verdict = "fragile"
        message = (f"Держится на отдельных периодах: прибыльных лишь {profitable} из {total}, суммарно "
                   f"{combined:+.1f}%. Общий результат тянут один-два окна — на других рынок её ломает.")

    return {
        "verdict": verdict, "message": message, "folds": folds,
        "avg_return_pct": avg_return, "combined_return_pct": combined,
        "profitable_folds": profitable, "total_folds": total, "candles": n,
    }

