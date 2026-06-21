import json

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.plans import PLAN_PRICES, effective_plan, entitlements, normalize_plan
from app.models.subscription import Subscription
from app.models.user import User
from app.schemas.payment import CheckoutIn, CheckoutOut, SubscriptionOut
from app.services.cryptobot import create_invoice, new_expiration, verify_webhook_signature

router = APIRouter()
settings = get_settings()


@router.get("/subscription", response_model=SubscriptionOut)
async def get_subscription(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriptionOut:
    sub = (
        await db.execute(select(Subscription).where(Subscription.user_id == current_user.id))
    ).scalar_one_or_none()
    admins = {e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()}
    is_admin = bool(current_user.email and current_user.email.lower() in admins)
    plan = effective_plan(
        sub.plan if sub else None,
        sub.expires_at if sub else None,
        free_mode=settings.free_mode or is_admin,
    )
    return SubscriptionOut(
        plan=plan,
        expires_at=sub.expires_at if sub else None,
        free_mode=settings.free_mode,
        paid_in_usdt=sub.paid_in_usdt if sub else 0.0,
        entitlements=entitlements(plan),
        prices=PLAN_PRICES,
    )


@router.post("/checkout", response_model=CheckoutOut)
async def checkout(
    payload: CheckoutIn,
    current_user: User = Depends(get_current_user),
) -> CheckoutOut:
    if settings.free_mode:
        raise HTTPException(status_code=400, detail="All plans are free during the launch promo.")
    price = PLAN_PRICES.get(payload.plan)
    if not price:
        raise HTTPException(status_code=400, detail="Unknown plan")
    # Encode the plan in the invoice payload so the webhook knows what was bought.
    invoice = await create_invoice(price, f"{current_user.id}:{payload.plan}", plan=payload.plan)
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
    # payload is "<user_id>:<plan>" (older invoices were just "<user_id>" → pro).
    raw_payload = str(invoice.get("payload") or "")
    parts = raw_payload.split(":", 1)
    try:
        user_id = int(parts[0])
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Missing user id in invoice payload") from exc
    plan = normalize_plan(parts[1]) if len(parts) > 1 else "pro"
    if plan == "free":  # never downgrade-to-free via a paid invoice
        plan = "pro"
    try:
        amount = float(invoice.get("amount", 0) or 0)
    except (TypeError, ValueError):
        amount = 0.0

    subscription = (
        await db.execute(select(Subscription).where(Subscription.user_id == user_id))
    ).scalar_one_or_none()
    if not subscription:
        subscription = Subscription(user_id=user_id, plan=plan, paid_in_usdt=amount)
        db.add(subscription)
    else:
        subscription.plan = plan
        subscription.paid_in_usdt += amount
    subscription.expires_at = new_expiration(subscription.expires_at)
    await db.commit()
    return {"ok": True}
