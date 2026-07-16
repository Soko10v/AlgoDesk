"""Smoke + fee-impact tests for the backtest simulator (pure, no network)."""

import math

from app.engine import risk
from app.services.backtest import _simulate


def _candles() -> list[list[float]]:
    """Synthetic OHLCV that trends up then down so MA-cross signals fire."""
    out: list[list[float]] = []
    price = 100.0
    for i in range(200):
        price += math.sin(i / 6.0) * 2.0  # oscillate to create crossovers
        o = price
        h = price * 1.01
        low = price * 0.99
        c = price * (1.001 if i % 2 == 0 else 0.999)
        out.append([float(i), o, h, low, c, 1000.0])
    return out


def _config(**extra) -> dict:
    return {
        "symbol": "BTC/USDT",
        "timeframe": "1h",
        "position_size_usdt": 100,
        "entry": [{"type": "ma_cross", "fast": 3, "slow": 8}],
        "exit": [],
        "stop_loss": {"type": "pct", "value": 2},
        "take_profit": {"type": "pct", "value": 3},
        "market": "spot",
        **extra,
    }


def test_simulate_returns_expected_shape():
    res = _simulate(_config(), _candles())
    assert set(res) >= {"total_return_pct", "max_drawdown_pct", "win_rate", "trades", "equity_curve"}
    assert isinstance(res["total_return_pct"], float)
    assert isinstance(res["trades"], list)
    assert res["equity_curve"] and all("y" in p for p in res["equity_curve"])


def test_simulate_is_deterministic():
    candles = _candles()
    assert _simulate(_config(), candles) == _simulate(_config(), candles)


def test_fees_do_not_increase_returns(monkeypatch):
    candles = _candles()
    # Zero-fee baseline.
    monkeypatch.setattr(risk, "SPOT_TAKER_FEE", 0.0)
    monkeypatch.setattr(risk, "FUTURES_TAKER_FEE", 0.0)
    no_fee = _simulate(_config(), candles)["total_return_pct"]
    # With a heavy fee the net return must not be higher than the fee-free run.
    monkeypatch.setattr(risk, "SPOT_TAKER_FEE", 0.01)
    with_fee = _simulate(_config(), candles)["total_return_pct"]
    assert with_fee <= no_fee + 1e-9


def _crash_candles() -> list[list[float]]:
    """Uptrend that suddenly crashes 60% in one candle — liquidation territory."""
    out: list[list[float]] = []
    price = 100.0
    for i in range(60):
        price *= 1.01
        out.append([float(i), price, price * 1.005, price * 0.995, price * 1.001, 1000.0])
    crash = price * 0.4
    out.append([60.0, price, price, crash, crash, 1000.0])
    for i in range(61, 80):
        out.append([float(i), crash, crash * 1.005, crash * 0.995, crash, 1000.0])
    return out


def test_equity_never_negative_with_leverage():
    cfg = _config(
        market="futures",
        leverage=10,
        direction="long",
        stop_loss={"type": "pct", "value": 50},  # stop far beyond liquidation
        take_profit={"type": "pct", "value": 0},
        entry=[{"type": "ma_cross", "fast": 3, "slow": 8}],
    )
    res = _simulate(cfg, _crash_candles())
    assert all(p["y"] >= 0 for p in res["equity_curve"])
    # The crash must resolve as a liquidation, not ride to the 50% stop.
    assert any(t.get("reason") == "liquidation" for t in res["trades"])


def test_cooldown_reduces_reentries():
    candles = _candles()
    base = _config(stop_loss={"type": "pct", "value": 0.5}, take_profit={"type": "pct", "value": 0})
    n_base = sum(1 for t in _simulate(base, candles)["trades"] if "pnl_pct" not in t)
    # Pause longer than the synthetic wave's half-period so blocked re-entries
    # actually fall inside the window.
    cooled = dict(base, cooldown_bars=60)
    n_cooled = sum(1 for t in _simulate(cooled, candles)["trades"] if "pnl_pct" not in t)
    assert n_cooled < n_base


def test_time_exit_closes_positions():
    cfg = _config(
        time_exit_bars=3,
        stop_loss={"type": "pct", "value": 50},
        take_profit={"type": "pct", "value": 0},
    )
    res = _simulate(cfg, _candles())
    closes = [t for t in res["trades"] if "pnl_pct" in t]
    assert closes and any(t["reason"] == "time_exit" for t in closes)
    # No position may outlive the limit.
    opens = [t for t in res["trades"] if "pnl_pct" not in t and t["leg"] == "main"]
    for o, c in zip(opens, closes):
        assert c["index"] - o["index"] <= 3


def test_break_even_exit_fires():
    """Rise enough to arm break-even, then fall back through the entry."""
    out: list[list[float]] = []
    price = 100.0
    for i in range(40):  # warmup for the MA
        out.append([float(i), price, price * 1.002, price * 0.998, price * (1.001 if i % 2 else 0.999), 1000.0])
    for i in range(40, 46):  # rally: entry + arm break-even
        price *= 1.02
        out.append([float(i), price, price * 1.01, price * 0.99, price, 1000.0])
    for i in range(46, 60):  # slow fade back to the entry zone
        price *= 0.985
        out.append([float(i), price, price * 1.005, price * 0.995, price, 1000.0])
    cfg = _config(
        break_even_pct=2.0,
        stop_loss={"type": "pct", "value": 30},
        take_profit={"type": "pct", "value": 0},
        entry=[{"type": "ma_cross", "fast": 3, "slow": 8}],
    )
    res = _simulate(cfg, out)
    assert any(t.get("reason") == "break_even" for t in res["trades"])


def test_slippage_does_not_increase_returns(monkeypatch):
    candles = _candles()
    monkeypatch.setattr(risk, "SLIPPAGE_PER_SIDE", 0.0)
    no_slip = _simulate(_config(), candles)["total_return_pct"]
    monkeypatch.setattr(risk, "SLIPPAGE_PER_SIDE", 0.01)
    with_slip = _simulate(_config(), candles)["total_return_pct"]
    assert with_slip <= no_slip + 1e-9


def test_exit_on_opposite_closes_longs():
    cfg = _config(
        exit_on_opposite=True,
        stop_loss={"type": "pct", "value": 50},
        take_profit={"type": "pct", "value": 0},
    )
    res = _simulate(cfg, _candles())
    closes = [t for t in res["trades"] if "pnl_pct" in t]
    assert closes and any(t["reason"] == "signal" for t in closes)
