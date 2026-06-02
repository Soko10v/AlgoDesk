from datetime import datetime

from pydantic import BaseModel, Field


class CheckoutIn(BaseModel):
    plan: str = Field(pattern="^(pro)$")


class CheckoutOut(BaseModel):
    invoice_id: str
    pay_url: str


class SubscriptionOut(BaseModel):
    plan: str
    expires_at: datetime | None = None

    model_config = {"from_attributes": True}
