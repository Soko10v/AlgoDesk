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
# Market-order slippage per side, charged in the backtest and in paper fills so
# both stay consistent (and slightly conservative) versus live execution.
SLIPPAGE_PER_SIDE = 0.0005    # 0.05%
# A leveraged position is liquidated by the exchange before the full margin is
# gone (maintenance margin + fees eat the rest). Approximate: liquidation hits
# at 90% of the naive 100%/leverage adverse move.
LIQUIDATION_BUFFER = 0.9
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


def round_trip_slippage(_config: dict[str, Any] | None = None) -> float:
    """Entry + exit market-order slippage as a fraction of notional."""
    return SLIPPAGE_PER_SIDE * 2


def liquidation_move_pct(config: dict[str, Any]) -> float | None:
    """Adverse price move (percent) at which the exchange liquidates a leveraged
    position, or None for unleveraged (spot / 1x) positions."""
    lev = leverage(config)
    if lev <= 1:
        return None
    return 100.0 / lev * LIQUIDATION_BUFFER


def cooldown_bars(config: dict[str, Any]) -> int:
    """Bars to pause entries after a stop-loss/trailing/liquidation exit (0 = off)."""
    return _nonneg_int(config.get("cooldown_bars"))


def time_exit_bars(config: dict[str, Any]) -> int:
    """Force-close a position after this many bars in it (0 = off)."""
    return _nonneg_int(config.get("time_exit_bars"))


def break_even_pct(config: dict[str, Any]) -> float | None:
    """Once price moves this % in favour, the stop moves to entry (None/0 = off)."""
    try:
        out = float(config.get("break_even_pct") or 0)
    except (TypeError, ValueError):
        return None
    return out if out > 0 else None


def exit_on_opposite(config: dict[str, Any]) -> bool:
    """Close a long-only position when the entry signal turns bearish."""
    return bool(config.get("exit_on_opposite"))


def _nonneg_int(value: Any) -> int:
    try:
        out = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, out)


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


def is_reversed(config: dict[str, Any]) -> bool:
    """True when the strategy runs mirrored: every long↔short, and the stop-loss
    and take-profit swap places (the side flip itself lives in strategy_evaluator)."""
    return bool(config.get("reverse"))


def stop_loss_pct(config: dict[str, Any]) -> float | None:
    """Effective stop-loss distance. A reversed strategy uses the take-profit value
    as its stop (the original target becomes the mirror's stop)."""
    return pct_value(config.get("take_profit") if is_reversed(config) else config.get("stop_loss"))


def take_profit_pct(config: dict[str, Any]) -> float | None:
    """Effective take-profit distance (the stop-loss value when reversed)."""
    return pct_value(config.get("stop_loss") if is_reversed(config) else config.get("take_profit"))


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
