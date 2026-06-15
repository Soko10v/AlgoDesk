"""Unit tests for trading-cost and risk helpers."""

from app.engine import risk


def _futures(**extra):
    return {"market": "futures", "leverage": 3, **extra}


def _spot(**extra):
    return {"market": "spot", **extra}


def test_taker_fee_differs_by_market():
    assert risk.taker_fee(_spot()) == risk.SPOT_TAKER_FEE
    assert risk.taker_fee(_futures()) == risk.FUTURES_TAKER_FEE


def test_round_trip_fee_is_two_sides():
    cfg = _spot()
    assert risk.round_trip_fee(cfg) == risk.taker_fee(cfg) * 2
    # The percent form is just the fraction * 100.
    assert risk.round_trip_fee_pct(cfg) == risk.round_trip_fee(cfg) * 100


def test_funding_only_on_futures():
    assert risk.funding_cost(_spot(), bars_held=100) == 0.0
    # Futures accrues a positive (cost) value over a holding period.
    assert risk.funding_cost(_futures(timeframe="1h"), bars_held=8) > 0.0


def test_funding_scales_with_holding_time():
    cfg = _futures(timeframe="1h")
    short_hold = risk.funding_cost(cfg, bars_held=1)
    long_hold = risk.funding_cost(cfg, bars_held=24)
    assert long_hold > short_hold


def test_leverage_is_clamped():
    assert risk.leverage(_spot()) == 1
    assert risk.leverage(_futures(leverage=999)) == risk.MAX_LEVERAGE
    assert risk.leverage(_futures(leverage=0)) == 1
    assert risk.leverage(_futures(leverage=3)) == 3


def test_pct_value_disabled_when_zero_or_missing():
    assert risk.pct_value({"type": "pct", "value": 0}) is None
    assert risk.pct_value({"type": "pct", "value": 2}) == 2.0
    assert risk.pct_value(None) is None
