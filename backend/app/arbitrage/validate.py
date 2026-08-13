"""Config validation for cash_and_carry / pairs (no directional entry blocks)."""

from typing import Any

from app.arbitrage.kinds import ARB_KINDS
from app.engine.risk import MAX_LEVERAGE

ALLOWED_TIMEFRAMES = frozenset({"5m", "15m", "1h", "4h", "1d"})
ALLOWED_DIRECTIONS = frozenset({"long", "both"})


def _positive_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0


def _validate_leverage(value: dict[str, Any]) -> None:
    lev = value.get("leverage", 1)
    try:
        lev = int(lev)
    except (TypeError, ValueError):
        raise ValueError("leverage must be an integer") from None
    if not 1 <= lev <= MAX_LEVERAGE:
        raise ValueError(f"leverage must be between 1 and {MAX_LEVERAGE}")
    direction = value.get("direction", "long")
    if direction not in ALLOWED_DIRECTIONS:
        raise ValueError("direction must be 'long' or 'both'")


def validate_arb_config(value: dict[str, Any]) -> dict[str, Any]:
    kind = value.get("kind")
    if kind not in ARB_KINDS:
        raise ValueError(f"Unknown arb kind: {kind}")
    if not (_positive_number(value.get("position_size_usdt")) or _positive_number(value.get("position_size_pct"))):
        raise ValueError("Set a position size: position_size_usdt (USD) or position_size_pct (%)")
    tf = value.get("timeframe", "1h")
    if tf not in ALLOWED_TIMEFRAMES:
        raise ValueError(f"Unsupported timeframe: {tf}")
    value["timeframe"] = tf

    if kind == "cash_and_carry":
        if not value.get("symbol"):
            raise ValueError("cash_and_carry requires symbol")
        for key in ("funding_entry_apr", "funding_exit_apr"):
            v = value.get(key)
            if v is not None and not (isinstance(v, (int, float)) and not isinstance(v, bool)):
                raise ValueError(f"{key} must be a number")
        basis = value.get("basis_min_pct")
        if basis is not None and not (isinstance(basis, (int, float)) and not isinstance(basis, bool)):
            raise ValueError("basis_min_pct must be a number")
        value.setdefault("market", "futures")
        value.setdefault("leverage", 2)
        _validate_leverage(value)
        return value

    if not value.get("symbol_a") or not value.get("symbol_b"):
        raise ValueError("pairs requires symbol_a and symbol_b")
    if value["symbol_a"] == value["symbol_b"]:
        raise ValueError("pairs symbol_a and symbol_b must differ")
    value.setdefault("symbol", value["symbol_a"])
    lookback = value.get("lookback", 48)
    if not (isinstance(lookback, int) and not isinstance(lookback, bool) and 10 <= lookback <= 500):
        raise ValueError("lookback must be an integer between 10 and 500")
    for key in ("z_entry", "z_exit"):
        v = value.get(key)
        if v is not None and not (isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0):
            raise ValueError(f"{key} must be a positive number")
    value.setdefault("market", "futures")
    value.setdefault("leverage", 2)
    value.setdefault("direction", "both")
    _validate_leverage(value)
    return value
