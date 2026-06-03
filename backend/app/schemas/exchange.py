from typing import Literal

from pydantic import BaseModel, Field


class ExchangeConnectIn(BaseModel):
    exchange: Literal["bybit", "binance"] = "bybit"
    api_key: str = Field(min_length=3)
    api_secret: str = Field(min_length=3)
