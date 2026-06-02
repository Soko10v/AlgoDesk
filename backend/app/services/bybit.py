from typing import Any

import ccxt.async_support as ccxt

from app.core.security import decrypt_secret
from app.models.user import User


def bybit_client(user: User | None = None) -> ccxt.bybit:
    params: dict[str, Any] = {"enableRateLimit": True}
    if user and user.api_key_encrypted and user.api_secret_encrypted:
        params["apiKey"] = decrypt_secret(user.api_key_encrypted)
        params["secret"] = decrypt_secret(user.api_secret_encrypted)
    return ccxt.bybit(params)


async def test_user_credentials(user: User) -> bool:
    client = bybit_client(user)
    try:
        await client.fetch_balance()
        return True
    except Exception:
        return False
    finally:
        await client.close()
