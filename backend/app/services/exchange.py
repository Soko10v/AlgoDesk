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


async def fetch_min_order(exchange: str, symbol: str, futures: bool, lev: int = 1) -> dict[str, Any]:
    """Minimum order for a symbol. Returns the exchange's minimum position notional
    AND the minimum *size* the user must enter, which — because size is margin —
    is min_notional / leverage. Public market data; never raises (returns zeros).
    """
    market_type = "futures" if futures else "spot"
    trade_symbol = perp_symbol(symbol) if futures else symbol
    lev = max(1, int(lev or 1))
    client = exchange_client(exchange, market_type=market_type)
    try:
        await client.load_markets()
        m = client.market(trade_symbol)
        limits = m.get("limits") or {}
        min_amount = ((limits.get("amount") or {}).get("min"))
        min_cost = ((limits.get("cost") or {}).get("min"))
        min_amount = float(min_amount) if min_amount is not None else 0.0
        price = 0.0
        try:
            ticker = await client.fetch_ticker(trade_symbol)
            price = float(ticker.get("last") or 0.0)
        except Exception:  # noqa: BLE001 - price is best-effort
            pass
        # Minimum tradable notional = the larger of the quantity floor (×price) and
        # any exchange-imposed cost floor.
        min_notional = min_amount * price if (min_amount and price) else 0.0
        if min_cost is not None:
            min_notional = max(min_notional, float(min_cost))
        # The user enters margin; leverage scales it into the position notional.
        min_size = min_notional / lev if lev else min_notional
        return {
            "symbol": symbol,
            "market": market_type,
            "leverage": lev,
            "min_amount": min_amount,
            "price": price,
            "min_notional": round(min_notional, 2),
            "min_size": round(min_size, 2),
        }
    except Exception as exc:  # noqa: BLE001 - degrade gracefully
        return {
            "symbol": symbol, "market": market_type, "leverage": lev, "min_amount": 0.0,
            "price": 0.0, "min_notional": 0.0, "min_size": 0.0, "error": str(exc)[:200],
        }
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
