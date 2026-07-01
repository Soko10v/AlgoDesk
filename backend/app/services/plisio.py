"""Plisio crypto payment gateway (primary, no-KYC) — white-label / on-page.

We create an invoice for a single coin and read back the deposit address, amount
and QR, then render them on our own page (no redirect). Payment is confirmed by
re-fetching the operation from Plisio with our API key.
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


def _qr(data: dict[str, Any]) -> str:
    """Normalise Plisio's QR into something an <img src> can render."""
    url = data.get("qr_url")
    if url:
        return str(url)
    code = data.get("qr_code")
    if code:
        return str(code) if str(code).startswith(("data:", "http")) else f"data:image/png;base64,{code}"
    return ""


async def create_invoice(amount: float, user_id: int, plan: str, callback_url: str) -> dict[str, str]:
    """Create a single-coin invoice and return the on-page payment details."""
    params = {
        "api_key": settings.plisio_api_key,
        "source_currency": "USD",
        "source_amount": str(amount),
        "currency": settings.plisio_currency,  # single coin → Plisio returns an address
        "order_number": f"{user_id}_{plan}_{uuid.uuid4().hex[:10]}",
        "order_name": f"AlgoDesk {plan.capitalize()} (1 month)",
        "callback_url": callback_url,
        "expire_min": "60",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(f"{PLISIO_API}/invoices/new", params=params)
        body = resp.json()
    if body.get("status") != "success":
        logger.warning("Plisio invoice error: %s", str(body)[:400])
        raise RuntimeError("Plisio invoice error")
    d = body.get("data") or {}
    address = d.get("wallet_hash") or d.get("address") or ""
    txn_id = str(d.get("txn_id") or d.get("id") or "")
    if not address and not d.get("invoice_url"):
        logger.warning("Plisio: no address/url in response: %s", str(d)[:400])
        raise RuntimeError("Plisio did not return a payment address")
    return {
        "invoice_id": txn_id,
        "pay_url": d.get("invoice_url", ""),  # fallback hosted page
        "address": address,
        "amount": str(d.get("amount") or d.get("pending_amount") or ""),
        "currency": str(d.get("currency") or settings.plisio_currency),
        "qr": _qr(d),
    }


async def operation(txn_id: str) -> dict[str, Any]:
    """Authoritative invoice state, fetched with our API key (this is how we trust
    a payment without verifying an incoming webhook's signature)."""
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(f"{PLISIO_API}/operations/{txn_id}", params={"api_key": settings.plisio_api_key})
        body = resp.json()
    return (body.get("data") or {}) if body.get("status") == "success" else {}
