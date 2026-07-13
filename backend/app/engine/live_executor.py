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

from app.core.redis import redis_client
from app.engine.risk import is_futures, leverage
from app.models.strategy import Strategy
from app.models.user import User
from app.services.exchange import exchange_client, perp_symbol

logger = logging.getLogger(__name__)

# Per-user cached futures position mode ("hedge" | "oneway"). We don't know how a
# user's account is configured, so we cache what worked last and self-correct: a
# wrong guess triggers the exchange's position-mode error, which flips the cache
# on retry. So if the user switches One-Way <-> Hedge on the exchange, the bot
# adapts automatically within one rejected order.
_POSMODE_KEY = "posmode:{exchange}:{uid}"
# Substrings exchanges use when the positionIdx/positionSide doesn't match the
# account's position mode (Bybit: "position idx not match position mode").
_POSMODE_HINTS = ("position idx", "position mode", "position side")


async def _cached_posmode(user: User) -> str | None:
    return await redis_client.get(_POSMODE_KEY.format(exchange=user.exchange, uid=user.id))


async def _store_posmode(user: User, hedged: bool) -> None:
    await redis_client.set(_POSMODE_KEY.format(exchange=user.exchange, uid=user.id), "hedge" if hedged else "oneway")


async def account_is_hedge(user: User) -> bool:
    """True only when we've confirmed (via a successful order) that the account
    is in hedge mode. Unknown/one-way both return False, so callers that need
    hedge support (the protective short leg) stay disabled until it's confirmed."""
    return (await _cached_posmode(user)) == "hedge"


def _is_posmode_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(hint in msg for hint in _POSMODE_HINTS)


def _order_symbol(strategy: Strategy) -> tuple[str, str]:
    """Return (symbol_to_trade, market_type) for the strategy."""
    symbol = strategy.config_json.get("symbol", "BTC/USDT")
    if is_futures(strategy.config_json):
        return perp_symbol(symbol), "futures"
    return symbol, "spot"


async def _spot_sell_amount(client, symbol: str, amount: float) -> float:
    """Sell amount that the spot wallet can actually cover.

    On a spot buy the exchange takes its fee out of the bought asset, so the
    wallet ends up holding slightly less than the ordered amount (buy 0.001146
    BTC → hold ~0.0011446). Selling the ordered amount then bounces with
    "Insufficient balance" — both the protective stop and the position close.
    Clamp to the free base balance (never above the requested amount, so a
    user's own separate holdings are never touched)."""
    try:
        base = symbol.split("/")[0]
        bal = await client.fetch_balance()
        free = float((bal.get("free") or {}).get(base) or 0.0)
        if 0 < free < amount:
            clamped = float(client.amount_to_precision(symbol, free))
            if clamped > 0:
                return clamped
    except Exception as exc:  # noqa: BLE001 - best-effort; keep the requested amount
        logger.warning("could not clamp spot sell amount for %s: %s", symbol, exc)
    return amount


def _position_params(exchange_id: str, position_side: str | None, reduce_only: bool, hedged: bool) -> dict:
    """Per-exchange params to target a position. ``hedged`` selects between the
    account's hedge mode (long/short held separately) and one-way mode."""
    params: dict = {}
    if reduce_only:
        params["reduceOnly"] = True
    if position_side:
        if exchange_id == "bybit":
            # Bybit: positionIdx 0 = one-way, 1 = hedge-long, 2 = hedge-short.
            params["positionIdx"] = (1 if position_side == "long" else 2) if hedged else 0
        elif hedged:  # binance and other ccxt unified exchanges, hedge mode only
            params["positionSide"] = position_side.upper()
    return params


async def _ensure_leverage(client, symbol: str, strategy: Strategy) -> None:
    lev = leverage(strategy.config_json)
    try:
        await client.set_leverage(lev, symbol)
    except Exception as exc:  # noqa: BLE001 - leverage may already be set; non-fatal
        logger.warning("could not set leverage %sx on %s: %s", lev, symbol, exc)


async def _fill_price(client, symbol: str, order: dict) -> float:
    """Resolve a market order's fill price. Bybit (and others) often return no
    average price on the immediate create_order response, so fall back to
    re-fetching the order, then to the current ticker. A non-zero price is
    critical: it's the entry used for PnL and stop-loss/take-profit."""
    price = float(order.get("average") or order.get("price") or 0.0)
    if price > 0:
        return price
    oid = order.get("id")
    if oid:
        try:
            fetched = await client.fetch_order(oid, symbol)
            price = float(fetched.get("average") or fetched.get("price") or 0.0)
            if price > 0:
                return price
        except Exception as exc:  # noqa: BLE001 - best-effort, fall through to ticker
            logger.warning("could not fetch order %s for fill price: %s", oid, exc)
    try:
        ticker = await client.fetch_ticker(symbol)
        return float(ticker.get("last") or 0.0)
    except Exception as exc:  # noqa: BLE001
        logger.warning("could not fetch ticker for %s fill price: %s", symbol, exc)
        return 0.0


async def live_order_amount(
    user: User,
    strategy: Strategy,
    price: float,
    override_usdt: float | None,
    size_mult: float = 1.0,
) -> float | None:
    """Resolve the order size (in base units) for a live entry, sized from the
    real account so it's actually affordable.

    The USD "position size" is treated as **margin**, so the position notional is
    size × leverage (spot leverage is 1, so size == notional there).
    - With an explicit USDT amount (set when starting the bot), that's the margin.
    - Else the strategy's configured USD size (position_size_usdt) is the margin.
    - Else (legacy strategies) "position size %" of the free USDT balance is the
      margin. All three are multiplied by leverage to get the position notional.

    Returns None when the resulting size is below the exchange minimum (caller
    should skip and warn) — this is what prevents the old behaviour of trying a
    fixed 0.1 BTC (~$6.5k) regardless of balance and spamming InsufficientFunds.
    """
    if price <= 0:
        return None
    symbol, market = _order_symbol(strategy)
    lev = leverage(strategy.config_json)
    client = exchange_client(user.exchange, user, market_type=market)
    try:
        await client.load_markets()
        m = client.market(symbol)
        cfg_usdt = strategy.config_json.get("position_size_usdt")
        if override_usdt and override_usdt > 0:
            notional = float(override_usdt) * lev
        elif cfg_usdt and float(cfg_usdt) > 0:
            # Configured USD margin → notional = margin × leverage.
            notional = float(cfg_usdt) * lev
        else:
            # Legacy strategies: percent of free balance as margin, × leverage.
            bal = await client.fetch_balance()
            free_usdt = float((bal.get("free") or {}).get("USDT") or 0.0)
            pct = float(strategy.config_json.get("position_size_pct", 10)) / 100
            notional = free_usdt * pct * lev
        if notional <= 0:
            return None
        notional *= size_mult  # volatility sizing (1.0 = off)
        amount = notional / price
        try:
            amount = float(client.amount_to_precision(symbol, amount))
        except Exception:  # noqa: BLE001 - precision is best-effort
            pass
        min_amt = ((m.get("limits") or {}).get("amount") or {}).get("min")
        if amount <= 0 or (min_amt is not None and amount < float(min_amt)):
            return None
        return amount
    finally:
        await client.close()


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
    symbol, market = _order_symbol(strategy)
    client = exchange_client(user.exchange, user, market_type=market)
    try:
        if market != "futures":
            if side == "sell":
                amount = await _spot_sell_amount(client, symbol, amount)
            order = await client.create_order(symbol=symbol, type="market", side=side, amount=amount, params={})
            return await _fill_price(client, symbol, order)

        await _ensure_leverage(client, symbol, strategy)
        # Try the cached position mode first; on a position-mode mismatch flip and
        # retry once, then remember what worked. This makes the order succeed on
        # both one-way and hedge accounts without knowing the setting up front.
        start_hedged = (await _cached_posmode(user)) == "hedge"
        last_exc: Exception | None = None
        for hedged in (start_hedged, not start_hedged):
            params = _position_params(user.exchange, position_side, reduce_only, hedged)
            try:
                order = await client.create_order(symbol=symbol, type="market", side=side, amount=amount, params=params)
                await _store_posmode(user, hedged)
                return await _fill_price(client, symbol, order)
            except Exception as exc:  # noqa: BLE001 - only swallow position-mode mismatches
                if _is_posmode_error(exc):
                    last_exc = exc
                    continue
                raise
        assert last_exc is not None
        raise last_exc
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
    symbol, market = _order_symbol(strategy)
    client = exchange_client(user.exchange, user, market_type=market)
    try:
        # reduceOnly is a futures concept; on spot the stop simply sells the held asset.
        params: dict = {"stopLossPrice": stop_price}
        if market == "futures":
            hedged = (await _cached_posmode(user)) == "hedge"
            params.update(_position_params(user.exchange, position_side, reduce_only=True, hedged=hedged))
        elif side == "sell":
            amount = await _spot_sell_amount(client, symbol, amount)
        order = await client.create_order(
            symbol=symbol, type="market", side=side, amount=amount, params=params
        )
        return str(order.get("id")) if order.get("id") is not None else None
    except Exception as exc:  # noqa: BLE001 - protective stop is best-effort
        logger.warning("could not place exchange stop for strategy %s: %s", strategy.id, exc)
        # The engine's in-memory stop still guards the position, but the user
        # should know the exchange-side safety net is missing.
        from app.services.telegram_alerts import send_admin_alert, send_telegram_alert

        await send_telegram_alert(
            user.telegram_id,
            f"⚠️ {strategy.name}: биржевой стоп-лосс не выставился ({exc}). "
            "Бот продолжит следить за стопом сам, но при перезапуске сервера позиция "
            "останется без защитного ордера на бирже.",
        )
        await send_admin_alert(f"stop order failed for strategy {strategy.id}: {exc}")
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
