from datetime import datetime

from pydantic import BaseModel, Field


class CheckoutIn(BaseModel):
    plan: str = Field(pattern="^(pro|expert)$")
    provider: str = Field(default="plisio", pattern="^(plisio|cryptobot|cryptomus)$")
    # USDT network for the on-page Plisio invoice. Whitelist only networks that
    # have an active wallet in the Plisio shop — an unlisted code makes
    # invoices/new fail with "Unsupported currency".
    network: str | None = Field(default=None, pattern="^(USDT_TRX|USDT_TON)$")


class CheckoutOut(BaseModel):
    invoice_id: str
    pay_url: str = ""
    # On-page (white-label) crypto payment details.
    address: str = ""
    amount: str = ""
    currency: str = ""
    qr: str = ""


class PayStatusOut(BaseModel):
    status: str = ""
    paid: bool = False


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
    # Lets the client show the admin-only analytics summary link.
    is_admin: bool = False
    # New-signup trial: full (expert) access for TRIAL_DAYS from account creation.
    trial_active: bool = False
    trial_ends_at: datetime | None = None
