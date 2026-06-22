"""Plisio crypto payment gateway (primary, no-KYC).

Create a hosted invoice via the API; the buyer pays in any enabled coin. Webhooks
are verified the robust way — by re-fetching the operation from Plisio with our
API key — instead of reproducing Plisio's PHP-serialize `verify_hash`.
Docs: https://plisio.net/documentation
"""

import logging
import uuid
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

PLISIO_API = "https://api.plisio.net/api/v1"
PAID_STATUSES = {"completed", "mismatch"}  # mismatch = overpaid, still counts


def is_configured() -> bool:
    return bool(settings.plisio_api_key)


async def create_invoice(amount: float, user_id: int, plan: str, callback_url: str, return_url: str) -> dict[str, str]:
    # order_number carries who/what so the webhook can map the payment back.
    params = {
        "api_key": settings.plisio_api_key,
        "source_currency": "USD",
        "source_amount": str(amount),
        "order_number": f"{user_id}_{plan}_{uuid.uuid4().hex[:10]}",
        "order_name": f"AlgoDesk {plan.capitalize()} (1 month)",
        "callback_url": callback_url,
        "success_callback_url": return_url,
        "fail_callback_url": return_url,
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(f"{PLISIO_API}/invoices/new", params=params)
        data = resp.json()
    if data.get("status") != "success":
        logger.warning("Plisio invoice error: %s", str(data)[:300])
        raise RuntimeError("Plisio invoice error")
    d = data.get("data") or {}
    pay_url = d.get("invoice_url", "")
    if not pay_url:
        raise RuntimeError("Plisio did not return invoice_url")
    return {"invoice_id": str(d.get("txn_id", "")), "pay_url": pay_url}


async def operation(txn_id: str) -> dict[str, Any]:
    """Authoritative status of an invoice, fetched with our API key (this is how
    we trust an incoming webhook without verifying its signature)."""
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(f"{PLISIO_API}/operations/{txn_id}", params={"api_key": settings.plisio_api_key})
        data = resp.json()
    return (data.get("data") or {}) if data.get("status") == "success" else {}
