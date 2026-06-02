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
    timestamp: datetime

    model_config = {"from_attributes": True}
