from typing import Any

import ccxt.async_support as ccxt

from app.core.security import decrypt_secret
from app.models.user import User

# Exchanges users can connect. Both are unified by ccxt, so the same symbols
# (e.g. "BTC/USDT") and calls work across them.
SUPPORTED_EXCHANGES: tuple[str, ...] = ("bybit", "binance")
DEFAULT_EXCHANGE = "bybit"


def normalize_exchange(name: str | None) -> str:
    candidate = (name or DEFAULT_EXCHANGE).lower()
    return candidate if candidate in SUPPORTED_EXCHANGES else DEFAULT_EXCHANGE


def exchange_client(name: str | None = None, user: User | None = None) -> ccxt.Exchange:
    """Build a ccxt client for the given exchange. When a user with stored keys
    is passed, the client is authenticated; otherwise it serves public data."""
    exchange_id = normalize_exchange(name)
    params: dict[str, Any] = {"enableRateLimit": True}
    if user and user.api_key_encrypted and user.api_secret_encrypted:
        params["apiKey"] = decrypt_secret(user.api_key_encrypted)
        params["secret"] = decrypt_secret(user.api_secret_encrypted)
    return getattr(ccxt, exchange_id)(params)


async def test_user_credentials(user: User) -> bool:
    client = exchange_client(user.exchange, user)
    try:
        await client.fetch_balance()
        return True
    except Exception:
        return False
    finally:
        await client.close()
