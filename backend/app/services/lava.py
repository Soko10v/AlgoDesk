"""Lava.top payments (secondary): cards / СБП / crypto subscriptions.

Outgoing API calls use the `X-Api-Key` header. Incoming webhooks are verified by
HTTP Basic auth (the login/password set in the Lava dashboard webhook config).
"""

import base64
import hmac
import logging
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.plans import PLAN_EXPERT, PLAN_PRO

logger = logging.getLogger(__name__)
settings = get_settings()

LAVA_API = "https://gate.lava.top/api/v2"


def is_configured() -> bool:
    return bool(settings.lava_api_key and (settings.lava_offer_pro or settings.lava_offer_expert))


def _offer_for(plan: str) -> str:
    return settings.lava_offer_expert if plan == PLAN_EXPERT else settings.lava_offer_pro


def plan_for_offer(offer_id: str) -> str | None:
    if offer_id and offer_id == settings.lava_offer_expert:
        return PLAN_EXPERT
    if offer_id and offer_id == settings.lava_offer_pro:
        return PLAN_PRO
    return None


async def create_invoice(plan: str, email: str) -> dict[str, str]:
    offer_id = _offer_for(plan)
    if not offer_id:
        raise RuntimeError(f"No Lava offer configured for plan {plan}")
    body = {"email": email, "offerId": offer_id, "currency": "USD"}
    headers = {"X-Api-Key": settings.lava_api_key, "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(f"{LAVA_API}/invoice", headers=headers, json=body)
        data = resp.json()
    # Lava returns the hosted payment link (field name has varied across versions).
    pay_url = data.get("paymentUrl") or data.get("url") or (data.get("data") or {}).get("url", "")
    if not pay_url:
        logger.warning("Lava invoice has no payment url: %s", str(data)[:300])
        raise RuntimeError("Lava did not return a payment URL")
    return {"invoice_id": str(data.get("id") or data.get("invoiceId") or ""), "pay_url": pay_url}


def verify_basic_auth(authorization: str) -> bool:
    """Validate the Basic auth header against the configured webhook login/password."""
    if not authorization.startswith("Basic ") or not settings.lava_webhook_password:
        return False
    try:
        decoded = base64.b64decode(authorization.split(" ", 1)[1]).decode()
    except Exception:  # noqa: BLE001
        return False
    expected = f"{settings.lava_webhook_login}:{settings.lava_webhook_password}"
    return hmac.compare_digest(decoded, expected)
