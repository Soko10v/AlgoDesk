from typing import Literal

from pydantic import BaseModel, Field


class ExchangeConnectIn(BaseModel):
    exchange: Literal["bybit", "binance"] = "bybit"
    api_key: str = Field(min_length=3)
    api_secret: str = Field(min_length=3)


class BalanceItem(BaseModel):
    asset: str
    free: float
    used: float
    total: float


class BalanceOut(BaseModel):
    connected: bool
    exchange: str
    usdt: float = 0.0
    balances: list[BalanceItem] = []
    # Set when the exchange rejected the balance request (e.g. bad key permissions).
    error: str | None = None
