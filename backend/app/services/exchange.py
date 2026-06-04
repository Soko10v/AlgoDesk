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


def perp_symbol(symbol: str) -> str:
    """Linear USDT-perpetual symbol for a spot pair, e.g. BTC/USDT -> BTC/USDT:USDT.
    Futures bots trade the perpetual; spot pairs are passed through unchanged."""
    return symbol if ":" in symbol else f"{symbol}:USDT"


def exchange_client(
    name: str | None = None,
    user: User | None = None,
    market_type: str = "spot",
) -> ccxt.Exchange:
    """Build a ccxt client for the given exchange. When a user with stored keys
    is passed, the client is authenticated; otherwise it serves public data.

    ``market_type="futures"`` switches the unified default to linear swaps so
    order/leverage calls target the perpetual market instead of spot."""
    exchange_id = normalize_exchange(name)
    default_type = "swap" if market_type == "futures" else "spot"
    params: dict[str, Any] = {"enableRateLimit": True, "options": {"defaultType": default_type}}
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


async def fetch_account_balance(user: User) -> dict[str, Any]:
    """Fetch the user's spot wallet balances from their exchange. Returns the
    non-zero holdings and the USDT total. Best-effort: never raises — on failure
    it returns an error payload so the profile page can degrade gracefully."""
    if not (user.api_key_encrypted and user.api_secret_encrypted):
        return {"connected": False, "exchange": user.exchange, "usdt": 0.0, "balances": []}
    client = exchange_client(user.exchange, user)
    try:
        raw = await client.fetch_balance()
    except Exception as exc:  # noqa: BLE001 - surface as a soft error, not a 500
        return {"connected": True, "exchange": user.exchange, "usdt": 0.0, "balances": [], "error": str(exc)[:200]}
    finally:
        await client.close()

    totals = raw.get("total") or {}
    free = raw.get("free") or {}
    used = raw.get("used") or {}
    balances: list[dict[str, Any]] = []
    for asset, total in totals.items():
        try:
            t = float(total or 0)
        except (TypeError, ValueError):
            continue
        if t <= 0:
            continue
        balances.append({
            "asset": asset,
            "free": float(free.get(asset) or 0),
            "used": float(used.get(asset) or 0),
            "total": t,
        })
    balances.sort(key=lambda b: b["total"], reverse=True)
    usdt = next((b["total"] for b in balances if b["asset"] == "USDT"), 0.0)
    return {"connected": True, "exchange": user.exchange, "usdt": usdt, "balances": balances[:25]}
