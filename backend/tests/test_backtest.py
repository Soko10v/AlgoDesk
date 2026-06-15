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
