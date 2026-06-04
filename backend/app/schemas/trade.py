from datetime import datetime

from pydantic import BaseModel


class TradeOut(BaseModel):
    id: int
    strategy_id: int
    symbol: str
    side: str
    price: float
    amount: float
    pnl: float | None
    leg: str = "main"
    timestamp: datetime

    model_config = {"from_attributes": True}


class TradeStatsOut(BaseModel):
    total_trades: int
    closed_trades: int
    wins: int
    win_rate: float
    avg_pnl: float
    total_pnl: float
    best_pnl: float
    worst_pnl: float
    hedge_trades: int
