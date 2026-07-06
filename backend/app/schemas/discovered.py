from datetime import datetime
from typing import Any

from pydantic import BaseModel


class DiscoveredOut(BaseModel):
    id: int
    title: str
    subtitle: str
    symbol: str
    timeframe: str
    config_json: dict[str, Any]
    total_return_pct: float
    max_drawdown_pct: float
    win_rate: float
    trades: int
    period_days: int
    rank: int
    discovered_at: datetime

    class Config:
        from_attributes = True
