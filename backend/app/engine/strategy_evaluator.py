from typing import Any

from app.engine.risk import allow_short
from app.services.indicators import ema, macd, rsi, sma


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


def _passes_filters(config: dict[str, Any], closes: list[float], want_side: str) -> bool:
    """Every configured entry filter must allow `want_side` ("long"/"short").

    Filters are extra conditions layered on top of the entry signal (the entry
    block decides the side; filters can veto it). Supported:
      - trend: price must be above the MA for longs, below it for shorts
        (e.g. only trade with the 200-EMA trend)
      - rsi:   skip longs when RSI is overbought (>= max), skip shorts when
        oversold (<= min)
    Not enough history for a filter's indicator vetoes the entry (conservative)."""
    for f in config.get("filters") or []:
        if not isinstance(f, dict):
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
    return True


def evaluate_signal(config: dict[str, Any], closes: list[float], position_side: str | None) -> str | None:
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

    Entry filters (config["filters"]) can veto an entry on either side."""
    if not closes:
        return None
    bullish, bearish = _entry_trend(config, closes)

    if allow_short(config):
        # Flip model: always sit on the trend side.
        if bullish and position_side != "long" and _passes_filters(config, closes, "long"):
            return "long"
        if bearish and position_side != "short" and _passes_filters(config, closes, "short"):
            return "short"
        return None

    # Long-only (unchanged semantics, plus entry filters).
    if position_side is None:
        return "long" if (bullish and _passes_filters(config, closes, "long")) else None
    if position_side == "long" and _rsi_exit(config, closes):
        return "close"
    return None
