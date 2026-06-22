from datetime import datetime

from pydantic import BaseModel, Field


class CheckoutIn(BaseModel):
    plan: str = Field(pattern="^(pro|expert)$")
    provider: str = Field(default="cryptomus", pattern="^(cryptomus|lava|cryptobot)$")


class CheckoutOut(BaseModel):
    invoice_id: str
    pay_url: str


class SubscriptionOut(BaseModel):
    plan: str  # the effective plan in force (free / pro / expert)
    expires_at: datetime | None = None
    # When true, the launch promo is active: every feature is unlocked for free.
    free_mode: bool = False
    # Lifetime USDT spent on subscriptions (the user's "wallet" history).
    paid_in_usdt: float = 0.0
    # Per-feature unlock map + plan prices so the client can gate the UI.
    entitlements: dict[str, bool] = {}
    prices: dict[str, float] = {}
