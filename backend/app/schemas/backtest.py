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


class AnalyzeIn(BaseModel):
    strategy_id: int
    start_date: date | None = None
    end_date: date | None = None


class AttemptInfo(BaseModel):
    n: int
    total_return_pct: float
    max_drawdown_pct: float
    win_rate: float
    trades: int
    proposed_changes: str = ""
    config: dict[str, Any] | None = None


class AnalyzeOut(BaseModel):
    verdict: str
    rating: str
    assessment: str
    proposed_changes: str
    proposed_config: dict[str, Any] | None = None
    improved: bool = False
    attempts: list[AttemptInfo] = []
    best_n: int | None = None
    original_return_pct: float = 0.0
    original_drawdown_pct: float = 0.0
    best_return_pct: float | None = None
    best_drawdown_pct: float | None = None


class AnalyzeStartOut(BaseModel):
    job_id: str


class AnalyzeStatusOut(BaseModel):
    status: str  # "running" | "done" | "error"
    attempt: int = 1
    result: AnalyzeOut | None = None
    error: str | None = None
