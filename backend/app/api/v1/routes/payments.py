import json

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.subscription import Subscription
from app.models.user import User
from app.schemas.payment import CheckoutIn, CheckoutOut, SubscriptionOut
from app.services.cryptobot import create_invoice, new_expiration, verify_webhook_signature

router = APIRouter()
settings = get_settings()

PLAN_PRICES = {"pro": 10.0}


@router.get("/subscription", response_model=SubscriptionOut)
async def get_subscription(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriptionOut:
    # Launch promo: hand everyone full (pro) access without touching billing rows.
    if settings.free_mode:
        return SubscriptionOut(plan="pro", expires_at=None, free_mode=True)
    sub = (
        await db.execute(select(Subscription).where(Subscription.user_id == current_user.id))
    ).scalar_one_or_none()
    if not sub:
        return SubscriptionOut(plan="free", expires_at=None)
    return SubscriptionOut.model_validate(sub)


@router.post("/checkout", response_model=CheckoutOut)
async def checkout(
    payload: CheckoutIn,
    current_user: User = Depends(get_current_user),
) -> CheckoutOut:
    if settings.free_mode:
        raise HTTPException(status_code=400, detail="All plans are free during the launch promo.")
    price = PLAN_PRICES.get(payload.plan, 0.0)
    invoice = await create_invoice(price, current_user.id)
    return CheckoutOut(**invoice)


@router.post("/webhook")
async def cryptobot_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    crypto_pay_api_signature: str = Header(default="", alias="crypto-pay-api-signature"),
) -> dict:
    raw_body = await request.body()
    if not verify_webhook_signature(raw_body, crypto_pay_api_signature):
        raise HTTPException(status_code=401, detail="Invalid signature")

    data = json.loads(raw_body or b"{}")
    if data.get("update_type") != "invoice_paid":
        return {"ok": True}

    invoice = data.get("payload") or {}
    try:
        user_id = int(invoice.get("payload"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Missing user id in invoice payload") from exc
    try:
        amount = float(invoice.get("amount", 0) or 0)
    except (TypeError, ValueError):
        amount = 0.0

    subscription = (
        await db.execute(select(Subscription).where(Subscription.user_id == user_id))
    ).scalar_one_or_none()
    if not subscription:
        subscription = Subscription(user_id=user_id, plan="pro", paid_in_usdt=amount)
        db.add(subscription)
    else:
        subscription.plan = "pro"
        subscription.paid_in_usdt += amount
    subscription.expires_at = new_expiration(subscription.expires_at)
    await db.commit()
    return {"ok": True}
