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

# Trading costs, charged so backtests/paper don't overstate returns vs live.
# Conservative taker fees (per side); a round trip pays entry + exit.
SPOT_TAKER_FEE = 0.001        # 0.10%
FUTURES_TAKER_FEE = 0.00055   # 0.055%
# Average funding drag on perpetuals (paid ~every 8h). Approximate and always
# treated as a cost so simulated futures returns stay conservative.
FUNDING_PER_8H = 0.0001       # ~0.01%
_TIMEFRAME_HOURS = {"5m": 5 / 60, "15m": 0.25, "1h": 1.0, "4h": 4.0, "1d": 24.0}


def taker_fee(config: dict[str, Any]) -> float:
    """Per-side taker fee as a fraction of notional."""
    return FUTURES_TAKER_FEE if is_futures(config) else SPOT_TAKER_FEE


def round_trip_fee(config: dict[str, Any]) -> float:
    """Entry + exit taker fee as a fraction of notional."""
    return taker_fee(config) * 2


def round_trip_fee_pct(config: dict[str, Any]) -> float:
    """Entry + exit taker fee as a percent of notional (price-move equivalent)."""
    return round_trip_fee(config) * 100


def timeframe_hours(config: dict[str, Any]) -> float:
    return _TIMEFRAME_HOURS.get(config.get("timeframe", "1h"), 1.0)


def funding_cost(config: dict[str, Any], bars_held: int) -> float:
    """Approximate funding paid over the holding period, as a fraction of
    notional. Futures only; 0 for spot."""
    if not is_futures(config):
        return 0.0
    hours = max(0, bars_held) * timeframe_hours(config)
    return FUNDING_PER_8H * (hours / 8.0)


def pct_value(rule: Any) -> float | None:
    """Absolute percent threshold for a ``{type: pct, value: n}`` rule, else None.
    A value of 0 (or missing) means the rule is disabled."""
    if isinstance(rule, dict) and rule.get("type") == "pct" and rule.get("value") is not None:
        try:
            out = abs(float(rule["value"]))
        except (TypeError, ValueError):
            return None
        return out if out > 0 else None
    return None


def trailing_pct(config: dict[str, Any]) -> float | None:
    """Trailing-stop distance in percent, or None when disabled."""
    return pct_value(config.get("trailing_stop"))


def is_futures(config: dict[str, Any]) -> bool:
    return config.get("market") == "futures"


def allow_short(config: dict[str, Any]) -> bool:
    """True when the strategy may open short positions: futures bots whose
    direction is set to "both". Spot and long-only futures stay long-only."""
    return is_futures(config) and config.get("direction") == "both"


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


def adverse_excursion_pct(prices: list[float], side: str = "long") -> float:
    """Percent of the fast move *against* the position within the window — the
    squeeze size. For a long that is a drop from the window peak; for a short it
    is a rise from the window trough. A large value means a fast adverse move."""
    if not prices:
        return 0.0
    if side == "short":
        trough = min(prices)
        if trough <= 0:
            return 0.0
        return (prices[-1] - trough) / trough * 100
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
