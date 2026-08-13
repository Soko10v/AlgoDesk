"""Arbitrage strategy helpers: kind detection, config defaults, signal logic.

Kinds:
  - cash_and_carry — spot long + perp short while funding APR is attractive
  - pairs — mean-reversion of the log-price spread between two perps (z-score)

Directional strategies omit ``kind`` (or set kind="directional").
"""

from __future__ import annotations

import math
from typing import Any, Literal

ArbKind = Literal["cash_and_carry", "pairs"]
ARB_KINDS = frozenset({"cash_and_carry", "pairs"})


def strategy_kind(config: dict[str, Any] | None) -> str:
    kind = (config or {}).get("kind") or "directional"
    return kind if kind in ARB_KINDS else "directional"


def is_arb_config(config: dict[str, Any] | None) -> bool:
    return strategy_kind(config) in ARB_KINDS


def default_carry_config(symbol: str = "BTC/USDT", position_size_usdt: float = 50) -> dict[str, Any]:
    return {
        "kind": "cash_and_carry",
        "symbol": symbol,
        "timeframe": "1h",  # unused for signals; kept for candle-stream compatibility
        "position_size_usdt": position_size_usdt,
        "market": "futures",  # clash detection / display; legs span spot+perp
        "leverage": 2,
        "direction": "long",
        # Enter when annualised funding APR exceeds this (percent).
        "funding_entry_apr": 15.0,
        # Exit when APR falls below this (or goes negative).
        "funding_exit_apr": 5.0,
        # Optional: require basis (perp-spot)/spot*100 not worse than this (None = off).
        "basis_min_pct": -0.5,
        # Dummy directional fields so shared helpers that peek at entry don't crash.
        "entry": [{"type": "ma_cross", "fast": 9, "slow": 21}],
        "exit": [],
        "stop_loss": {"type": "pct", "value": 0},
        "take_profit": {"type": "pct", "value": 0},
    }


def default_pairs_config(
    symbol_a: str = "BTC/USDT",
    symbol_b: str = "ETH/USDT",
    position_size_usdt: float = 50,
) -> dict[str, Any]:
    return {
        "kind": "pairs",
        "symbol": symbol_a,  # primary for price-stream / clash
        "symbol_a": symbol_a,
        "symbol_b": symbol_b,
        "timeframe": "1h",
        "lookback": 48,
        "z_entry": 2.0,
        "z_exit": 0.5,
        "position_size_usdt": position_size_usdt,
        "market": "futures",
        "leverage": 2,
        "direction": "both",
        "entry": [{"type": "ma_cross", "fast": 9, "slow": 21}],
        "exit": [],
        "stop_loss": {"type": "pct", "value": 0},
        "take_profit": {"type": "pct", "value": 0},
    }


def carry_should_enter(
    funding_apr_pct: float,
    basis_pct: float,
    config: dict[str, Any],
) -> bool:
    """Open carry when funding is rich enough and basis isn't too adverse."""
    entry = float(config.get("funding_entry_apr") or 15.0)
    if funding_apr_pct < entry:
        return False
    basis_min = config.get("basis_min_pct")
    if basis_min is not None and basis_pct < float(basis_min):
        return False
    return True


def carry_should_exit(funding_apr_pct: float, config: dict[str, Any]) -> bool:
    exit_apr = float(config.get("funding_exit_apr") or 5.0)
    return funding_apr_pct < exit_apr


def log_spread(price_a: float, price_b: float) -> float | None:
    if price_a <= 0 or price_b <= 0:
        return None
    return math.log(price_a) - math.log(price_b)


def zscore(values: list[float]) -> float | None:
    """Z-score of the last value vs the series mean/std. Needs ≥ 5 points."""
    if len(values) < 5:
        return None
    mean = sum(values) / len(values)
    var = sum((v - mean) ** 2 for v in values) / len(values)
    std = math.sqrt(var)
    if std < 1e-12:
        return 0.0
    return (values[-1] - mean) / std


def pairs_signal(
    closes_a: list[float],
    closes_b: list[float],
    config: dict[str, Any],
    position_side: str | None,
) -> Literal["long", "short", "close"] | None:
    """Mean-reversion on log-spread.

    long  = long A / short B (spread depressed)
    short = short A / long B (spread elevated)
    """
    n = min(len(closes_a), len(closes_b), int(config.get("lookback") or 48))
    if n < 10:
        return None
    spreads: list[float] = []
    for i in range(-n, 0):
        s = log_spread(closes_a[i], closes_b[i])
        if s is not None:
            spreads.append(s)
    z = zscore(spreads)
    if z is None:
        return None
    z_entry = float(config.get("z_entry") or 2.0)
    z_exit = float(config.get("z_exit") or 0.5)

    if position_side is None:
        if z >= z_entry:
            return "short"
        if z <= -z_entry:
            return "long"
        return None

    # Exit when the spread mean-reverts inside the band.
    if abs(z) <= z_exit:
        return "close"
    # Flip if the other extreme is hit.
    if position_side == "long" and z >= z_entry:
        return "short"
    if position_side == "short" and z <= -z_entry:
        return "long"
    return None
