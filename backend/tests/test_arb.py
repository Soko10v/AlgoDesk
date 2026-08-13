"""Unit tests for arbitrage helpers (no network)."""

from app.arbitrage.kinds import (
    carry_should_enter,
    carry_should_exit,
    default_carry_config,
    default_pairs_config,
    is_arb_config,
    pairs_signal,
    strategy_kind,
    zscore,
)
from app.arbitrage.opportunities import basis_pct, funding_apr_pct


def test_kind_detection():
    assert strategy_kind({}) == "directional"
    assert strategy_kind({"kind": "cash_and_carry"}) == "cash_and_carry"
    assert strategy_kind({"kind": "pairs"}) == "pairs"
    assert is_arb_config(default_carry_config())
    assert is_arb_config(default_pairs_config())
    assert not is_arb_config({"symbol": "BTC/USDT", "entry": []})


def test_funding_apr():
    # 0.01% per 8h → ~10.95% APR
    assert abs(funding_apr_pct(0.0001) - 10.95) < 0.01


def test_basis():
    assert abs(basis_pct(100, 101) - 1.0) < 1e-9
    assert basis_pct(0, 1) == 0.0


def test_carry_thresholds():
    cfg = default_carry_config()
    cfg["funding_entry_apr"] = 20
    cfg["funding_exit_apr"] = 5
    cfg["basis_min_pct"] = -1
    assert carry_should_enter(25, 0, cfg)
    assert not carry_should_enter(10, 0, cfg)
    assert not carry_should_enter(25, -2, cfg)  # basis too adverse
    assert carry_should_exit(3, cfg)
    assert not carry_should_exit(10, cfg)


def test_zscore_and_pairs():
    assert zscore([1, 1, 1, 1]) is None  # too short
    z = zscore([1, 2, 3, 4, 5, 6, 7, 8, 9, 100])
    assert z is not None and z > 2

    # Flat series → no signal
    a = [100.0] * 50
    b = [50.0] * 50
    assert pairs_signal(a, b, default_pairs_config(), None) is None

    # Elevate A relative to B at the end → short A / long B
    a2 = [100.0] * 40 + [120.0] * 10
    b2 = [50.0] * 50
    cfg = default_pairs_config()
    cfg["z_entry"] = 1.5
    sig = pairs_signal(a2, b2, cfg, None)
    assert sig == "short"
