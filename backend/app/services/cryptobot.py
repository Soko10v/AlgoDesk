from datetime import UTC, datetime, timedelta
import hashlib
import hmac

import httpx

from app.core.config import get_settings

settings = get_settings()


def cryptobot_headers() -> dict[str, str]:
    return {"Crypto-Pay-API-Token": settings.cryptobot_token}


async def create_invoice(amount: float, payload: str | int, plan: str = "pro") -> dict[str, str]:
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            "https://pay.crypt.bot/api/createInvoice",
            headers=cryptobot_headers(),
            json={
                "asset": "USDT",
                "amount": str(amount),
                "description": f"AlgoDesk {plan.capitalize()} subscription (1 month)",
                "payload": str(payload),
            },
        )
        body = response.json()
        result = body.get("result", {})
        return {"invoice_id": str(result.get("invoice_id")), "pay_url": result.get("pay_url", "")}


def verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
    """Verify a CryptoPay webhook: HMAC-SHA256 of the raw body keyed by
    sha256(api_token), compared against the `crypto-pay-api-signature` header."""
    token = settings.cryptobot_token
    if not token or not signature:
        return False
    secret = hashlib.sha256(token.encode("utf-8")).digest()
    digest = hmac.new(secret, raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, signature)


def new_expiration(now: datetime | None, days: int = 30) -> datetime:
    base = now if now and now > datetime.now(UTC) else datetime.now(UTC)
    return base + timedelta(days=days)
