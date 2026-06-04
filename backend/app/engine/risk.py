"""Risk helpers shared by the live engine and the backtester so that stop-loss,
take-profit and hedge behaviour stay identical between simulation and live.

Hedging only applies to futures strategies (``market == "futures"``); spot bots
are long-only and cannot short, so they ignore everything below the basics."""

from typing import Any

# Keep no-code users away from self-liquidation: cap leverage and hedge size.
MAX_LEVERAGE = 10
DEFAULT_HEDGE_AUTO_RATIO = 1.0
DEFAULT_HEDGE_PARTIAL_RATIO = 0.3
DEFAULT_TRIGGER_PCT = 3.0
DEFAULT_WINDOW_SEC = 60
DEFAULT_RELEASE_PCT = 1.5


def pct_value(rule: Any) -> float | None:
    """Absolute percent threshold for a ``{type: pct, value: n}`` rule, else None."""
    if isinstance(rule, dict) and rule.get("type") == "pct" and rule.get("value") is not None:
        try:
            return abs(float(rule["value"]))
        except (TypeError, ValueError):
            return None
    return None


def is_futures(config: dict[str, Any]) -> bool:
    return config.get("market") == "futures"


def leverage(config: dict[str, Any]) -> int:
    if not is_futures(config):
        return 1
    try:
        lev = int(config.get("leverage", 1))
    except (TypeError, ValueError):
        return 1
    return max(1, min(lev, MAX_LEVERAGE))


def hedge_params(config: dict[str, Any]) -> dict[str, Any] | None:
    """Normalised hedge settings for a futures strategy with hedging enabled,
    or None when hedging does not apply. Missing fields fall back to defaults."""
    if not is_futures(config):
        return None
    hedge = config.get("hedge")
    if not isinstance(hedge, dict) or not hedge.get("enabled"):
        return None
    mode = hedge.get("mode", "auto_squeeze")
    if mode not in ("auto_squeeze", "constant_partial"):
        mode = "auto_squeeze"
    default_ratio = DEFAULT_HEDGE_AUTO_RATIO if mode == "auto_squeeze" else DEFAULT_HEDGE_PARTIAL_RATIO
    return {
        "mode": mode,
        "ratio": _clamp_ratio(hedge.get("ratio", default_ratio)),
        "trigger_pct": _pos_float(hedge.get("trigger_pct"), DEFAULT_TRIGGER_PCT),
        "window_sec": _pos_int(hedge.get("window_sec"), DEFAULT_WINDOW_SEC),
        "release_pct": _pos_float(hedge.get("release_pct"), DEFAULT_RELEASE_PCT),
    }


def squeeze_drop_pct(prices: list[float]) -> float:
    """Percent drop from the highest price in the window to the latest one.
    A large positive value means a fast adverse move (a squeeze)."""
    if not prices:
        return 0.0
    peak = max(prices)
    if peak <= 0:
        return 0.0
    return (peak - prices[-1]) / peak * 100


def _clamp_ratio(value: Any) -> float:
    try:
        return max(0.0, min(float(value), 1.0))
    except (TypeError, ValueError):
        return DEFAULT_HEDGE_PARTIAL_RATIO


def _pos_float(value: Any, fallback: float) -> float:
    try:
        out = float(value)
        return out if out > 0 else fallback
    except (TypeError, ValueError):
        return fallback


def _pos_int(value: Any, fallback: int) -> int:
    try:
        out = int(value)
        return out if out > 0 else fallback
    except (TypeError, ValueError):
        return fallback
