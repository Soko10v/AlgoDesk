"""Cryptomus payment gateway (primary): crypto + card checkout.

Docs: https://doc.cryptomus.com — auth is a `merchant` header + a `sign` header
that is md5(base64(json_body) + api_key). The same scheme verifies webhooks.
"""

import base64
import hashlib
import hmac
import json
import logging
import uuid
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

CRYPTOMUS_API = "https://api.cryptomus.com/v1"


def is_configured() -> bool:
    return bool(settings.cryptomus_merchant and settings.cryptomus_api_key)


def _encode(body: dict[str, Any]) -> str:
    # Cryptomus signs base64 of the JSON body. PHP's json_encode escapes slashes,
    # so match it for the signature to line up.
    raw = json.dumps(body, separators=(",", ":")).replace("/", "\\/")
    return base64.b64encode(raw.encode()).decode()


def _sign(body: dict[str, Any]) -> str:
    return hashlib.md5((_encode(body) + settings.cryptomus_api_key).encode()).hexdigest()


async def create_invoice(amount: float, user_id: int, plan: str, callback_url: str, return_url: str) -> dict[str, str]:
    body: dict[str, Any] = {
        "amount": str(amount),
        "currency": "USD",
        "order_id": f"{user_id}-{plan}-{uuid.uuid4().hex[:12]}",
        "url_callback": callback_url,
        "url_return": return_url,
        "additional_data": f"{user_id}:{plan}",
        "lifetime": 3600,
    }
    headers = {"merchant": settings.cryptomus_merchant, "sign": _sign(body), "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(f"{CRYPTOMUS_API}/payment", headers=headers, json=body)
        data = resp.json()
    result = data.get("result") or {}
    pay_url = result.get("url", "")
    if not pay_url:
        logger.warning("Cryptomus invoice has no url: %s", str(data)[:300])
        raise RuntimeError("Cryptomus did not return a payment URL")
    return {"invoice_id": str(result.get("uuid", "")), "pay_url": pay_url}


def verify_webhook(payload: dict[str, Any]) -> bool:
    """Webhook sign = md5(base64(body without `sign`) + api_key)."""
    received = payload.get("sign")
    if not received:
        return False
    body = {k: v for k, v in payload.items() if k != "sign"}
    expected = hashlib.md5((_encode(body) + settings.cryptomus_api_key).encode()).hexdigest()
    return hmac.compare_digest(expected, str(received))


def is_paid(payload: dict[str, Any]) -> bool:
    return str(payload.get("status")) in {"paid", "paid_over"}
