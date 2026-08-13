"""Arbitrage module: scanner, cash-and-carry, pairs. Isolated from directional bots."""

from app.arbitrage.kinds import (
    ARB_KINDS,
    carry_should_enter,
    carry_should_exit,
    default_carry_config,
    default_pairs_config,
    is_arb_config,
    pairs_signal,
    strategy_kind,
    zscore,
)

__all__ = [
    "ARB_KINDS",
    "carry_should_enter",
    "carry_should_exit",
    "default_carry_config",
    "default_pairs_config",
    "is_arb_config",
    "pairs_signal",
    "strategy_kind",
    "zscore",
]
