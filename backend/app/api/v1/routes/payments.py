import json
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.plans import PLAN_PRICES, effective_plan, entitlements, normalize_plan
from app.models.subscription import Subscription
from app.models.user import User
from app.schemas.payment import CheckoutIn, CheckoutOut, PayStatusOut, SubscriptionOut
from app.services import cryptomus, plisio
from app.services.cryptobot import create_invoice as cryptobot_invoice
from app.services.cryptobot import new_expiration, verify_webhook_signature

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()


async def _activate(db: AsyncSession, user_id: int, plan: str, amount: float = 0.0) -> None:
    """Upsert the user's subscription to `plan` and extend it by a month."""
    plan = normalize_plan(plan)
    if plan == "free":  # a paid webhook never downgrades to free
        plan = "pro"
    sub = (
        await db.execute(select(Subscription).where(Subscription.user_id == user_id))
    ).scalar_one_or_none()
    if not sub:
        sub = Subscription(user_id=user_id, plan=plan, paid_in_usdt=amount)
        db.add(sub)
    else:
        sub.plan = plan
        sub.paid_in_usdt += amount
    sub.expires_at = new_expiration(sub.expires_at)
    await db.commit()
    logger.info("Subscription activated: user=%s plan=%s amount=%s", user_id, plan, amount)


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

    base = settings.public_base_url.rstrip("/")
    try:
        if payload.provider == "plisio":
            if not plisio.is_configured():
                raise HTTPException(status_code=503, detail="Crypto payments are not configured yet.")
            invoice = await plisio.create_invoice(
                price, current_user.id, payload.plan,
                callback_url=f"{base}/api/v1/payments/plisio/webhook",
            )
        elif payload.provider == "cryptomus":
            if not cryptomus.is_configured():
                raise HTTPException(status_code=503, detail="Card/crypto payments are not configured yet.")
            invoice = await cryptomus.create_invoice(
                price, current_user.id, payload.plan,
                callback_url=f"{base}/api/v1/payments/cryptomus/webhook",
                return_url=f"{base}/subscription",
            )
        else:  # cryptobot (USDT in Telegram)
            invoice = await cryptobot_invoice(price, f"{current_user.id}:{payload.plan}", plan=payload.plan)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - surface provider/transport failures
        logger.warning("Checkout failed (%s): %s", payload.provider, exc)
        raise HTTPException(status_code=502, detail="Payment provider error — try again or another method.")
    return CheckoutOut(**invoice)


@router.get("/status/{txn_id}", response_model=PayStatusOut)
async def payment_status(
    txn_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PayStatusOut:
    """Polled by the on-page payment panel. Confirms with Plisio (our API key) and
    activates the plan the moment it's paid — so we don't rely on the webhook alone."""
    op = await plisio.operation(txn_id)
    status = str(op.get("status") or "")
    order_number = str(op.get("order_number") or "")
    parts = order_number.split("_")
    # Only the owner of this invoice may poll/activate it.
    if len(parts) < 2 or parts[0] != str(current_user.id):
        return PayStatusOut(status="", paid=False)
    paid = status in plisio.PAID_STATUSES
    if paid:
        try:
            amount = float(op.get("source_amount") or 0)
        except (TypeError, ValueError):
            amount = 0.0
        await _activate(db, current_user.id, parts[1], amount)
    return PayStatusOut(status=status, paid=paid)


@router.api_route("/plisio/webhook", methods=["GET", "POST"])
async def plisio_webhook(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    # Accept GET (Plisio's Status-URL validation ping / GET callbacks) and POST
    # (form or JSON). We don't trust the body's hash; instead we re-fetch the
    # operation from Plisio with our API key.
    payload: dict = dict(request.query_params)
    if request.method == "POST":
        try:
            payload.update({k: v for k, v in (await request.form()).items()})
        except Exception:  # noqa: BLE001
            try:
                payload.update(await request.json())
            except Exception:  # noqa: BLE001
                pass
    txn_id = payload.get("txn_id") or payload.get("id")
    if not txn_id:
        return {"ok": True}  # validation ping with no data — don't error
    op = await plisio.operation(str(txn_id))
    status = str(op.get("status") or payload.get("status") or "")
    if status not in plisio.PAID_STATUSES:
        return {"ok": True}
    order_number = str(op.get("order_number") or payload.get("order_number") or "")
    parts = order_number.split("_")
    if len(parts) < 2 or not parts[0].isdigit():
        logger.warning("Plisio webhook unmapped order_number=%s", order_number)
        return {"ok": True}
    try:
        amount = float(op.get("source_amount") or payload.get("source_amount") or 0)
    except (TypeError, ValueError):
        amount = 0.0
    await _activate(db, int(parts[0]), parts[1], amount)
    return {"ok": True}


@router.post("/cryptomus/webhook")
async def cryptomus_webhook(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    payload = await request.json()
    if not cryptomus.verify_webhook(payload):
        raise HTTPException(status_code=401, detail="Invalid signature")
    if not cryptomus.is_paid(payload):
        return {"ok": True}
    user_id, _, plan = str(payload.get("additional_data") or "").partition(":")
    try:
        uid = int(user_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Bad additional_data") from exc
    try:
        amount = float(payload.get("amount", 0) or 0)
    except (TypeError, ValueError):
        amount = 0.0
    await _activate(db, uid, plan or "pro", amount)
    return {"ok": True}


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
    user_id, _, plan = str(invoice.get("payload") or "").partition(":")
    try:
        uid = int(user_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Missing user id in invoice payload") from exc
    try:
        amount = float(invoice.get("amount", 0) or 0)
    except (TypeError, ValueError):
        amount = 0.0
    await _activate(db, uid, plan or "pro", amount)
    return {"ok": True}
