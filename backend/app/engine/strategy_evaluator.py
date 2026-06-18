from typing import Any

import numpy as np
import pandas as pd

from app.engine.risk import allow_short
from app.services.indicators import (
    adx,
    adx_series,
    atr,
    atr_series,
    ema,
    ema_series,
    macd,
    macd_series,
    rsi,
    rsi_series,
    sma,
    sma_series,
)


def _entry_trend(config: dict[str, Any], closes: list[float]) -> tuple[bool, bool]:
    """Return (bullish, bearish) from the entry rule. Supports several block
    types so users have more building blocks to find an edge with."""
    rule = (config.get("entry") or [{}])[0]
    rtype = rule.get("type", "ma_cross")

    if rtype in ("ma_cross", "ema_cross"):
        fn = sma if rtype == "ma_cross" else ema
        fast = fn(closes, int(rule.get("fast", 9)))
        slow = fn(closes, int(rule.get("slow", 21)))
        if fast is None or slow is None:
            return False, False
        return fast > slow, fast < slow

    if rtype == "rsi":
        value = rsi(closes, int(rule.get("period", 14)))
        if value is None:
            return False, False
        low = float(rule.get("low", 30))
        high = float(rule.get("high", 70))
        # Mean reversion: oversold is bullish, overbought is bearish.
        return value < low, value > high

    if rtype == "breakout":
        period = int(rule.get("period", 20))
        if len(closes) < period + 1:
            return False, False
        window = closes[-period - 1 : -1]
        last = closes[-1]
        return last > max(window), last < min(window)

    if rtype == "macd":
        out = macd(closes, int(rule.get("fast", 12)), int(rule.get("slow", 26)), int(rule.get("signal", 9)))
        if out is None:
            return False, False
        line, sig = out
        return line > sig, line < sig

    return False, False


def _rsi_exit(config: dict[str, Any], closes: list[float]) -> bool:
    for rule in config.get("exit", []):
        if rule.get("type") == "rsi":
            value = rsi(closes, 14)
            if value is None:
                continue
            threshold = float(rule.get("value", 70))
            op = rule.get("op", ">")
            if (op == ">" and value > threshold) or (op == "<" and value < threshold):
                return True
    return False


def _passes_filters(
    config: dict[str, Any], closes: list[float], want_side: str, candles: list[list[float]] | None = None
) -> bool:
    """Every configured entry filter must allow `want_side` ("long"/"short").

    Filters are extra conditions layered on top of the entry signal (the entry
    block decides the side; filters can veto it). Supported:
      - trend:  price above the MA for longs, below it for shorts (trade with the trend)
      - rsi:    skip longs when RSI >= max (overbought), shorts when <= min (oversold)
      - volume: current bar's volume must beat mult × its average (confirm the move)
      - atr:    ATR% (volatility) must sit within [min_pct, max_pct] (skip flat/too wild)
      - adx:    ADX (trend strength) must be >= min (skip choppy ranges)
    volume/atr/adx need OHLCV (``candles``, aligned with ``closes``) and apply to both
    sides. Not enough history for a filter's indicator vetoes the entry (conservative)."""
    highs = [float(c[2]) for c in candles] if candles else []
    lows = [float(c[3]) for c in candles] if candles else []

    for f in config.get("filters") or []:
        if not isinstance(f, dict):
            continue
        # A side-specific filter only constrains its own side; skip it otherwise.
        fside = f.get("side", "both")
        if fside != "both" and fside != want_side:
            continue
        ftype = f.get("type")
        if ftype == "trend":
            ma_fn = sma if f.get("ma") == "sma" else ema
            ma = ma_fn(closes, int(f.get("period", 200)))
            if ma is None:
                return False
            price = closes[-1]
            if want_side == "long" and not price > ma:
                return False
            if want_side == "short" and not price < ma:
                return False
        elif ftype == "rsi":
            value = rsi(closes, int(f.get("period", 14)))
            if value is None:
                return False
            hi = f.get("max")
            lo = f.get("min")
            if want_side == "long" and hi is not None and value >= float(hi):
                return False
            if want_side == "short" and lo is not None and value <= float(lo):
                return False
        elif ftype == "volume":
            if not candles:
                return False
            period = int(f.get("period", 20))
            vols = [float(c[5]) for c in candles if len(c) > 5 and c[5] is not None]
            if len(vols) <= period:
                return False
            avg = sum(vols[-period:]) / period
            if avg <= 0 or vols[-1] < float(f.get("mult", 1.5)) * avg:
                return False
        elif ftype == "atr":
            if not candles:
                return False
            value = atr(highs, lows, closes, int(f.get("period", 14)))
            price = closes[-1]
            if value is None or not price:
                return False
            atr_pct = value / price * 100
            lo, hi = f.get("min_pct"), f.get("max_pct")
            if lo is not None and atr_pct < float(lo):
                return False
            if hi is not None and atr_pct > float(hi):
                return False
        elif ftype == "adx":
            if not candles:
                return False
            value = adx(highs, lows, closes, int(f.get("period", 14)))
            if value is None or value < float(f.get("min", 20)):
                return False
    return True


_FLIP = {"long": "short", "short": "long"}


def _flip_action(action: str | None) -> str | None:
    """Mirror a decision for a reversed strategy: long↔short; close/None unchanged."""
    return _FLIP.get(action, action)


def _decide(
    allow_short_flag: bool,
    position_side: str | None,
    bullish: bool,
    bearish: bool,
    long_ok: bool,
    short_ok: bool,
    rsi_exit_flag: bool,
) -> str | None:
    """The position-aware decision, shared by the live (per-bar) and backtest
    (precomputed) paths so they can never diverge."""
    if allow_short_flag:
        if bullish and position_side != "long" and long_ok:
            return "long"
        if bearish and position_side != "short" and short_ok:
            return "short"
        return None
    if position_side is None:
        return "long" if (bullish and long_ok) else None
    if position_side == "long" and rsi_exit_flag:
        return "close"
    return None


def _entry_trend_series(config: dict[str, Any], closes: list[float]) -> tuple["np.ndarray", "np.ndarray"]:
    """(bullish, bearish) boolean arrays for every bar — same rules as _entry_trend."""
    n = len(closes)
    false = np.zeros(n, dtype=bool)
    rule = (config.get("entry") or [{}])[0]
    rtype = rule.get("type", "ma_cross")

    if rtype in ("ma_cross", "ema_cross"):
        fn = sma_series if rtype == "ma_cross" else ema_series
        fast = fn(closes, int(rule.get("fast", 9)))
        slow = fn(closes, int(rule.get("slow", 21)))
        return fast > slow, fast < slow
    if rtype == "rsi":
        val = rsi_series(closes, int(rule.get("period", 14)))
        return val < float(rule.get("low", 30)), val > float(rule.get("high", 70))
    if rtype == "breakout":
        period = int(rule.get("period", 20))
        c = pd.Series(closes, dtype=float)
        roll_max = c.shift(1).rolling(period).max().to_numpy()
        roll_min = c.shift(1).rolling(period).min().to_numpy()
        arr = c.to_numpy()
        return arr > roll_max, arr < roll_min
    if rtype == "macd":
        line, sig = macd_series(closes, int(rule.get("fast", 12)), int(rule.get("slow", 26)), int(rule.get("signal", 9)))
        return line > sig, line < sig
    return false, false


def _filter_series(
    config: dict[str, Any], closes: list[float], candles: list[list[float]]
) -> tuple["np.ndarray", "np.ndarray"]:
    """(long_ok, short_ok) boolean arrays — same vetoes as _passes_filters.

    Each filter can carry a ``side`` ("long"/"short"/"both", default both): its veto
    is applied only to the matching side, so a long/short bot can use different
    conditions per direction (e.g. long only in an uptrend, short only in a downtrend)."""
    n = len(closes)
    long_ok = np.ones(n, dtype=bool)
    short_ok = np.ones(n, dtype=bool)
    arr = np.asarray(closes, dtype=float)
    highs = [float(c[2]) for c in candles]
    lows = [float(c[3]) for c in candles]

    for f in config.get("filters") or []:
        if not isinstance(f, dict):
            continue
        ftype = f.get("type")
        # This filter's per-side allowance (True = entry permitted on that side).
        lok = np.ones(n, dtype=bool)
        sok = np.ones(n, dtype=bool)
        if ftype == "trend":
            ma = (sma_series if f.get("ma") == "sma" else ema_series)(closes, int(f.get("period", 200)))
            lok = arr > ma
            sok = arr < ma
        elif ftype == "rsi":
            val = rsi_series(closes, int(f.get("period", 14)))
            valid = ~np.isnan(val)
            lok = valid.copy()
            sok = valid.copy()
            if f.get("max") is not None:
                lok &= val < float(f["max"])
            if f.get("min") is not None:
                sok &= val > float(f["min"])
        elif ftype == "volume":
            period = int(f.get("period", 20))
            vols = pd.Series([float(c[5]) if len(c) > 5 and c[5] is not None else np.nan for c in candles], dtype=float)
            avg = vols.rolling(period).mean().to_numpy()
            idx = np.arange(n)
            with np.errstate(invalid="ignore"):
                ok = (idx >= period) & (avg > 0) & (vols.to_numpy() >= float(f.get("mult", 1.5)) * avg)
            lok = sok = ok
        elif ftype == "atr":
            a = atr_series(highs, lows, closes, int(f.get("period", 14)))
            with np.errstate(invalid="ignore", divide="ignore"):
                atr_pct = np.where(arr != 0, a / arr * 100, np.nan)
            ok = ~np.isnan(atr_pct)
            if f.get("min_pct") is not None:
                ok &= atr_pct >= float(f["min_pct"])
            if f.get("max_pct") is not None:
                ok &= atr_pct <= float(f["max_pct"])
            lok = sok = ok
        elif ftype == "adx":
            v = adx_series(highs, lows, closes, int(f.get("period", 14)))
            ok = ~np.isnan(v) & (v >= float(f.get("min", 20)))
            lok = sok = ok
        else:
            continue

        side = f.get("side", "both")
        if side in ("long", "both"):
            long_ok &= lok
        if side in ("short", "both"):
            short_ok &= sok
    return long_ok, short_ok


def _rsi_exit_series(config: dict[str, Any], closes: list[float]) -> "np.ndarray":
    n = len(closes)
    out = np.zeros(n, dtype=bool)
    for rule in config.get("exit", []):
        if rule.get("type") == "rsi":
            val = rsi_series(closes, 14)
            thr = float(rule.get("value", 70))
            if rule.get("op", ">") == ">":
                out |= val > thr
            else:
                out |= val < thr
    return out


def build_signals(config: dict[str, Any], candles: list[list[float]]) -> dict[str, Any]:
    """Precompute per-bar signal/filter/exit booleans for a whole candle set, so a
    backtest can decide each bar with an array lookup instead of recomputing every
    indicator over a growing slice (O(n) vs O(n²))."""
    closes = [c[4] for c in candles]
    bullish, bearish = _entry_trend_series(config, closes)
    long_ok, short_ok = _filter_series(config, closes, candles)
    return {
        "allow_short": allow_short(config),
        "reverse": bool(config.get("reverse")),
        "bullish": bullish,
        "bearish": bearish,
        "long_ok": long_ok,
        "short_ok": short_ok,
        "rsi_exit": _rsi_exit_series(config, closes),
    }


def signal_at(sig: dict[str, Any], idx: int, position_side: str | None) -> str | None:
    """Decision for bar ``idx`` from precomputed ``build_signals`` output.

    A reversed strategy is the mirror image: we feed the conjugate position side
    into the normal logic and flip the resulting action, so every long becomes a
    short (and the RSI exit still lines up). SL/TP swapping is handled in the sim."""
    reverse = sig.get("reverse")
    inner_side = _flip_action(position_side) if reverse else position_side
    action = _decide(
        sig["allow_short"],
        inner_side,
        bool(sig["bullish"][idx]),
        bool(sig["bearish"][idx]),
        bool(sig["long_ok"][idx]),
        bool(sig["short_ok"][idx]),
        bool(sig["rsi_exit"][idx]),
    )
    return _flip_action(action) if reverse else action


def evaluate_signal(
    config: dict[str, Any],
    closes: list[float],
    position_side: str | None,
    candles: list[list[float]] | None = None,
) -> str | None:
    """Decide the next action given the open position.

    `position_side` is None (flat), "long" or "short". Returns one of:
      "long"  — open (or flip to) a long
      "short" — open (or flip to) a short
      "close" — close the current position to flat
      None    — hold

    Long-only strategies (spot, or futures with direction != "both") enter long
    on a bullish entry signal and exit on the RSI rule. Futures bots with
    direction "both" follow the trend and flip on the opposite signal (RSI is
    not used — the entry block drives the side, SL/TP/trailing still protect).

    Entry filters (config["filters"]) can veto an entry on either side. Used live
    (once per tick); the backtest uses build_signals/signal_at for the same logic."""
    if not closes:
        return None
    reverse = bool(config.get("reverse"))
    inner_side = _flip_action(position_side) if reverse else position_side
    bullish, bearish = _entry_trend(config, closes)
    action = _decide(
        allow_short(config),
        inner_side,
        bullish,
        bearish,
        _passes_filters(config, closes, "long", candles),
        _passes_filters(config, closes, "short", candles),
        _rsi_exit(config, closes),
    )
    return _flip_action(action) if reverse else action
