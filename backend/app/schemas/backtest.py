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
