"""Live order helpers for multi-leg arbitrage (spot + futures, or two perps).

Separate from place_live_order because arb strategies span markets/symbols that
a single strategy.config_json.market cannot describe.
"""

from __future__ import annotations

import logging

from app.engine.live_executor import (
    _cached_posmode,
    _ensure_leverage,
    _fill_price,
    _is_posmode_error,
    _position_params,
    _spot_sell_amount,
    _store_posmode,
)
from app.engine.risk import leverage
from app.models.strategy import Strategy
from app.models.user import User
from app.services.exchange import exchange_client, perp_symbol

logger = logging.getLogger(__name__)


async def place_market_leg(
    user: User,
    strategy: Strategy,
    *,
    market: str,
    symbol: str,
    side: str,
    amount: float,
    position_side: str | None = None,
    reduce_only: bool = False,
) -> float:
    """Market order on an explicit market/symbol. Returns fill price."""
    trade_symbol = perp_symbol(symbol) if market == "futures" else symbol
    client = exchange_client(user.exchange, user, market_type=market)
    try:
        if market != "futures":
            if side == "sell":
                amount = await _spot_sell_amount(client, trade_symbol, amount)
            order = await client.create_order(
                symbol=trade_symbol, type="market", side=side, amount=amount, params={}
            )
            return await _fill_price(client, trade_symbol, order)

        await _ensure_leverage(client, trade_symbol, strategy)
        start_hedged = (await _cached_posmode(user)) == "hedge"
        last_exc: Exception | None = None
        for hedged in (start_hedged, not start_hedged):
            params = _position_params(user.exchange, position_side, reduce_only, hedged)
            try:
                order = await client.create_order(
                    symbol=trade_symbol, type="market", side=side, amount=amount, params=params
                )
                await _store_posmode(user, hedged)
                return await _fill_price(client, trade_symbol, order)
            except Exception as exc:  # noqa: BLE001
                if _is_posmode_error(exc):
                    last_exc = exc
                    continue
                raise
        assert last_exc is not None
        raise last_exc
    finally:
        await client.close()


async def leg_amount(
    user: User,
    strategy: Strategy,
    price: float,
    override_usdt: float | None,
    *,
    market: str = "futures",
) -> float | None:
    """Base-asset size from USD margin × leverage for the given market."""
    if price <= 0:
        return None
    lev = leverage(strategy.config_json) if market == "futures" else 1
    cfg_usdt = strategy.config_json.get("position_size_usdt")
    if override_usdt and override_usdt > 0:
        notional = float(override_usdt) * lev
    elif cfg_usdt and float(cfg_usdt) > 0:
        notional = float(cfg_usdt) * lev
    else:
        pct = float(strategy.config_json.get("position_size_pct", 10)) / 100
        # Without a live balance peek, use a conservative 100 USDT notional * pct.
        notional = 100.0 * pct * lev
    amount = notional / price
    return amount if amount > 0 else None
