from datetime import date
from typing import Any

from pydantic import BaseModel


class BacktestIn(BaseModel):
    strategy_id: int
    start_date: date | None = None
    end_date: date | None = None


class BacktestOut(BaseModel):
    total_return_pct: float
    max_drawdown_pct: float
    win_rate: float
    trades: list[dict[str, Any]]
    equity_curve: list[dict[str, float]]
    price_series: list[dict[str, float]] = []  # OHLC per candle: {x,o,h,l,c}
    candles: int = 0
    start: float | None = None  # unix seconds of the first candle tested
    end: float | None = None    # unix seconds of the last candle tested


class OptimizeIn(BaseModel):
    strategy_id: int
    start_date: date | None = None
    end_date: date | None = None


class OptimizeResult(BaseModel):
    config: dict[str, Any]
    total_return_pct: float
    max_drawdown_pct: float
    win_rate: float
    trades: int
    score: float


class OptimizeOut(BaseModel):
    results: list[OptimizeResult]
    tested: int
    candles: int
