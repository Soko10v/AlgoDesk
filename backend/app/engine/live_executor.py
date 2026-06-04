"""Live order placement on the exchange.

Spot strategies are long-only (buy then sell what you hold). Futures strategies
trade the linear perpetual, can hold a short hedge leg alongside the long, and
get a real exchange-side stop-loss order so the position is protected even if
this process dies or price gaps between engine ticks.

⚠️ The futures/hedge order params (hedge-mode position side, reduce-only) are
exchange-specific and must be validated on a testnet before trading real funds.
The user's futures account must be in **hedge mode** to hold a long and a short
on the same symbol at once.
"""

import logging

from app.engine.risk import is_futures, leverage
from app.models.strategy import Strategy
from app.models.user import User
from app.services.exchange import exchange_client, perp_symbol

logger = logging.getLogger(__name__)


def _order_symbol(strategy: Strategy) -> tuple[str, str]:
    """Return (symbol_to_trade, market_type) for the strategy."""
    symbol = strategy.config_json.get("symbol", "BTC/USDT")
    if is_futures(strategy.config_json):
        return perp_symbol(symbol), "futures"
    return symbol, "spot"


def _position_params(exchange_id: str, position_side: str | None, reduce_only: bool) -> dict:
    """Per-exchange params to target a side of a hedge-mode position."""
    params: dict = {}
    if reduce_only:
        params["reduceOnly"] = True
    if position_side:
        if exchange_id == "bybit":
            # Bybit hedge mode: 1 = long position, 2 = short position.
            params["positionIdx"] = 1 if position_side == "long" else 2
        else:  # binance and other ccxt unified exchanges
            params["positionSide"] = position_side.upper()
    return params


async def _ensure_leverage(client, symbol: str, strategy: Strategy) -> None:
    lev = leverage(strategy.config_json)
    try:
        await client.set_leverage(lev, symbol)
    except Exception as exc:  # noqa: BLE001 - leverage may already be set; non-fatal
        logger.warning("could not set leverage %sx on %s: %s", lev, symbol, exc)


async def place_live_order(
    user: User,
    strategy: Strategy,
    side: str,
    amount: float,
    *,
    reduce_only: bool = False,
    position_side: str | None = None,
) -> float:
    """Market order. Returns the average fill price (0.0 if unavailable)."""
    if not strategy.live_enabled:
        raise ValueError("Live trading is disabled for this strategy.")
    symbol, market = _order_symbol(strategy)
    client = exchange_client(user.exchange, user, market_type=market)
    try:
        params: dict = {}
        if market == "futures":
            await _ensure_leverage(client, symbol, strategy)
            params = _position_params(user.exchange, position_side, reduce_only)
        order = await client.create_order(symbol=symbol, type="market", side=side, amount=amount, params=params)
        return float(order.get("average") or order.get("price") or 0.0)
    finally:
        await client.close()


async def place_stop_order(
    user: User,
    strategy: Strategy,
    side: str,
    amount: float,
    stop_price: float,
    *,
    position_side: str | None = None,
) -> str | None:
    """Place a reduce-only stop-market order that the exchange triggers on its
    own. Best-effort: returns the order id, or None if the exchange rejected it
    (the engine keeps an in-memory stop as a fallback either way)."""
    if not strategy.live_enabled:
        return None
    symbol, market = _order_symbol(strategy)
    client = exchange_client(user.exchange, user, market_type=market)
    try:
        # reduceOnly is a futures concept; on spot the stop simply sells the held asset.
        params: dict = {"stopLossPrice": stop_price}
        if market == "futures":
            params.update(_position_params(user.exchange, position_side, reduce_only=True))
        order = await client.create_order(
            symbol=symbol, type="market", side=side, amount=amount, params=params
        )
        return str(order.get("id")) if order.get("id") is not None else None
    except Exception as exc:  # noqa: BLE001 - protective stop is best-effort
        logger.warning("could not place exchange stop for strategy %s: %s", strategy.id, exc)
        return None
    finally:
        await client.close()


async def cancel_order(user: User, strategy: Strategy, order_id: str) -> None:
    """Cancel a previously placed order (e.g. the protective stop) on close.
    Swallows errors: the order may have already filled or been cancelled."""
    symbol, market = _order_symbol(strategy)
    client = exchange_client(user.exchange, user, market_type=market)
    try:
        await client.cancel_order(order_id, symbol)
    except Exception as exc:  # noqa: BLE001 - already gone is fine
        logger.info("stop order %s already gone for strategy %s: %s", order_id, strategy.id, exc)
    finally:
        await client.close()
