"""Arbitrage bot tick: cash-and-carry and pairs mean-reversion.

Called from BotSupervisor._run_once when config.kind is an arb kind. Reuses the
supervisor's trade settlement helpers and BotState (position_side marks the
spread direction; legs use Trade.leg = spot/perp or a/b).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.arbitrage.kinds import (
    carry_should_enter,
    carry_should_exit,
    pairs_signal,
    strategy_kind,
)
from app.arbitrage.live import leg_amount, place_market_leg
from app.arbitrage.opportunities import basis_pct, funding_apr_pct
from app.engine.paper_executor import build_paper_trade, paper_fill_price
from app.engine.risk import leverage
from app.models.strategy import Strategy
from app.models.trade import Trade
from app.models.user import User
from app.services.events import publish_user_event
from app.services.exchange import exchange_client, perp_symbol
from app.services.telegram_alerts import send_telegram_alert
from app.core.redis import redis_client

logger = logging.getLogger(__name__)


async def _redis_price(symbol: str) -> float | None:
    raw = await redis_client.get(f"price:{symbol.replace('/', '_')}")
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


async def _fetch_funding_apr(symbol: str, exchange: str = "bybit") -> tuple[float, float, float]:
    """Return (funding_apr_pct, basis_pct, spot_price). Falls back to Redis last."""
    spot = await _redis_price(symbol) or 0.0
    perp_price = await _redis_price(symbol) or spot
    rate = 0.0
    client = exchange_client(exchange, market_type="futures")
    try:
        perp = perp_symbol(symbol)
        try:
            if hasattr(client, "fetch_funding_rate"):
                data = await client.fetch_funding_rate(perp)
                if data.get("fundingRate") is not None:
                    rate = float(data["fundingRate"])
        except Exception as exc:  # noqa: BLE001
            logger.debug("funding fetch failed: %s", exc)
        try:
            t = await client.fetch_ticker(perp)
            perp_price = float(t.get("last") or perp_price)
        except Exception:  # noqa: BLE001
            pass
    finally:
        await client.close()
    if spot <= 0:
        spot = perp_price
    return funding_apr_pct(rate), basis_pct(spot, perp_price), spot


async def run_arb_once(supervisor: Any, db: AsyncSession, user: User, strategy: Strategy, state: Any) -> None:
    kind = strategy_kind(strategy.config_json)
    if kind == "cash_and_carry":
        await _run_carry(supervisor, db, user, strategy, state)
    elif kind == "pairs":
        await _run_pairs(supervisor, db, user, strategy, state)


async def _run_carry(supervisor: Any, db: AsyncSession, user: User, strategy: Strategy, state: Any) -> None:
    cfg = strategy.config_json
    symbol = cfg.get("symbol", "BTC/USDT")
    apr, basis, spot = await _fetch_funding_apr(symbol, user.exchange or "bybit")
    if spot <= 0:
        return

    if not state.has_position:
        if not carry_should_enter(apr, basis, cfg):
            return
        if await supervisor._entry_blocked_by_risk(db, user, strategy):
            return
        amount = await _size(user, strategy, state, spot, market="spot")
        if amount is None or amount <= 0:
            await supervisor._cooldown_and_warn(user, strategy, "size")
            return
        await _open_carry(supervisor, db, user, strategy, state, symbol, spot, amount, apr)
    else:
        if carry_should_exit(apr, cfg):
            await _close_carry(supervisor, db, user, strategy, state, symbol, spot, "funding")


async def _size(user: User, strategy: Strategy, state: Any, price: float, *, market: str) -> float | None:
    if state.mode == "live":
        return await leg_amount(user, strategy, price, state.position_size_usdt, market=market)
    lev = leverage(strategy.config_json) if market == "futures" else 1
    if price <= 0:
        return None
    usdt = state.position_size_usdt or float(strategy.config_json.get("position_size_usdt") or 50)
    return usdt * lev / price


async def _open_carry(
    supervisor: Any,
    db: AsyncSession,
    user: User,
    strategy: Strategy,
    state: Any,
    symbol: str,
    spot: float,
    amount: float,
    apr: float,
) -> None:
    """Buy spot + short perp of matching base size."""
    if state.mode == "live":
        spot_px = await place_market_leg(
            user, strategy, market="spot", symbol=symbol, side="buy", amount=amount
        )
        perp_px = await place_market_leg(
            user,
            strategy,
            market="futures",
            symbol=symbol,
            side="sell",
            amount=amount,
            position_side="short",
        )
        db.add(
            Trade(
                strategy_id=strategy.id,
                symbol=symbol,
                side="buy",
                price=spot_px or spot,
                amount=amount,
                pnl=None,
                leg="spot",
                mode="live",
                timestamp=datetime.now(UTC),
            )
        )
        db.add(
            Trade(
                strategy_id=strategy.id,
                symbol=symbol,
                side="sell",
                price=perp_px or spot,
                amount=amount,
                pnl=None,
                leg="perp",
                mode="live",
                timestamp=datetime.now(UTC),
            )
        )
        fill = spot_px or spot
    else:
        db.add(build_paper_trade(strategy, "buy", spot, amount, leg="spot"))
        db.add(build_paper_trade(strategy, "sell", spot, amount, leg="perp"))
        fill = paper_fill_price(spot, "buy")

    state.position_side = "long"  # carry open (delta-neutral)
    state.position_amount = amount
    state.entry_price = fill
    state.extreme_price = fill
    state.entry_at = datetime.now(UTC)
    await db.commit()
    await publish_user_event(
        user.id,
        {
            "type": "trade_opened",
            "strategy_id": strategy.id,
            "strategy": strategy.name,
            "side": "carry",
            "symbol": symbol,
            "message": f"Carry opened · funding APR ~{apr:.1f}%",
        },
    )
    await send_telegram_alert(
        user.telegram_id,
        f"📈 Carry «{strategy.name}»: spot long + perp short {symbol} @ ~{fill:.4f} (APR {apr:.1f}%)",
    )


async def _close_carry(
    supervisor: Any,
    db: AsyncSession,
    user: User,
    strategy: Strategy,
    state: Any,
    symbol: str,
    spot: float,
    reason: str,
) -> None:
    amount = state.position_amount or 0.0
    if amount <= 0:
        supervisor._clear_position(state)
        return
    entry = state.entry_price or spot

    if state.mode == "live":
        spot_px = await place_market_leg(
            user, strategy, market="spot", symbol=symbol, side="sell", amount=amount, reduce_only=False
        )
        perp_px = await place_market_leg(
            user,
            strategy,
            market="futures",
            symbol=symbol,
            side="buy",
            amount=amount,
            position_side="short",
            reduce_only=True,
        )
        # Approx combined PnL: spot (sell-buy) + perp (entry_short - cover).
        spot_pnl = (spot_px - entry) * amount if spot_px else 0.0
        # Perp short PnL ≈ (entry - cover) * amount; we don't store separate entry —
        # use spot entry as proxy for the matched hedge.
        perp_pnl = (entry - (perp_px or spot)) * amount
        total = spot_pnl + perp_pnl
    else:
        spot_exit = paper_fill_price(spot, "sell")
        perp_exit = paper_fill_price(spot, "buy")
        total = (spot_exit - entry) * amount + (entry - perp_exit) * amount

    await supervisor._settle_open_trade(db, strategy.id, "spot", total / 2)
    await supervisor._settle_open_trade(db, strategy.id, "perp", total / 2)
    supervisor._clear_position(state)
    await db.commit()
    await publish_user_event(
        user.id,
        {
            "type": "trade_closed",
            "strategy_id": strategy.id,
            "strategy": strategy.name,
            "pnl": total,
            "reason": reason,
        },
    )
    await send_telegram_alert(
        user.telegram_id,
        f"📉 Carry «{strategy.name}» closed ({reason}): PnL {total:+.2f} USDT",
    )


async def _run_pairs(supervisor: Any, db: AsyncSession, user: User, strategy: Strategy, state: Any) -> None:
    cfg = strategy.config_json
    sym_a = cfg.get("symbol_a") or cfg.get("symbol", "BTC/USDT")
    sym_b = cfg.get("symbol_b", "ETH/USDT")

    candles_a = await supervisor._recent_candles({**cfg, "symbol": sym_a})
    candles_b = await supervisor._recent_candles({**cfg, "symbol": sym_b})
    rows_a = candles_a[:-1] if len(candles_a) > 1 else candles_a
    rows_b = candles_b[:-1] if len(candles_b) > 1 else candles_b
    closes_a = [float(c[4]) for c in rows_a if c and len(c) > 4 and c[4] is not None]
    closes_b = [float(c[4]) for c in rows_b if c and len(c) > 4 and c[4] is not None]
    if len(closes_a) < 10 or len(closes_b) < 10:
        return

    signal = pairs_signal(closes_a, closes_b, cfg, state.position_side)
    px_a = await _redis_price(sym_a) or closes_a[-1]
    px_b = await _redis_price(sym_b) or closes_b[-1]

    if not state.has_position:
        if signal not in ("long", "short"):
            return
        if await supervisor._entry_blocked_by_risk(db, user, strategy):
            return
        amt_a = await _size(user, strategy, state, px_a, market="futures")
        amt_b = await _size(user, strategy, state, px_b, market="futures")
        if not amt_a or not amt_b:
            await supervisor._cooldown_and_warn(user, strategy, "size")
            return
        await _open_pairs(supervisor, db, user, strategy, state, signal, sym_a, sym_b, px_a, px_b, amt_a, amt_b)
    else:
        if signal == "close" or (signal in ("long", "short") and signal != state.position_side):
            reason = "signal" if signal == "close" else "flip"
            await _close_pairs(supervisor, db, user, strategy, state, sym_a, sym_b, px_a, px_b, reason)
            if signal in ("long", "short") and signal != state.position_side:
                # Flip on next tick after flat.
                pass


async def _open_pairs(
    supervisor: Any,
    db: AsyncSession,
    user: User,
    strategy: Strategy,
    state: Any,
    side: str,
    sym_a: str,
    sym_b: str,
    px_a: float,
    px_b: float,
    amt_a: float,
    amt_b: float,
) -> None:
    # long = long A / short B; short = short A / long B
    side_a = "buy" if side == "long" else "sell"
    side_b = "sell" if side == "long" else "buy"
    pos_a = "long" if side == "long" else "short"
    pos_b = "short" if side == "long" else "long"

    if state.mode == "live":
        fa = await place_market_leg(
            user, strategy, market="futures", symbol=sym_a, side=side_a, amount=amt_a, position_side=pos_a
        )
        fb = await place_market_leg(
            user, strategy, market="futures", symbol=sym_b, side=side_b, amount=amt_b, position_side=pos_b
        )
        db.add(
            Trade(
                strategy_id=strategy.id,
                symbol=sym_a,
                side=side_a,
                price=fa or px_a,
                amount=amt_a,
                pnl=None,
                leg="a",
                mode="live",
                timestamp=datetime.now(UTC),
            )
        )
        db.add(
            Trade(
                strategy_id=strategy.id,
                symbol=sym_b,
                side=side_b,
                price=fb or px_b,
                amount=amt_b,
                pnl=None,
                leg="b",
                mode="live",
                timestamp=datetime.now(UTC),
            )
        )
        fill_a, fill_b = fa or px_a, fb or px_b
    else:
        t_a = build_paper_trade(strategy, side_a, px_a, amt_a, leg="a")
        t_a.symbol = sym_a
        t_b = build_paper_trade(strategy, side_b, px_b, amt_b, leg="b")
        t_b.symbol = sym_b
        db.add(t_a)
        db.add(t_b)
        fill_a, fill_b = paper_fill_price(px_a, side_a), paper_fill_price(px_b, side_b)

    state.position_side = side
    state.position_amount = amt_a  # primary size; B stored via hedge_extreme
    state.entry_price = fill_a
    state.extreme_price = fill_a
    state.entry_at = datetime.now(UTC)
    # Stash B amount on hedge fields to reuse on close.
    state.hedge_open = True
    state.hedge_side = pos_b
    state.hedge_entry_price = fill_b
    state.hedge_extreme = amt_b  # reuse field as amount_b storage
    await db.commit()
    await publish_user_event(
        user.id,
        {
            "type": "trade_opened",
            "strategy_id": strategy.id,
            "strategy": strategy.name,
            "side": side,
            "symbol": f"{sym_a}/{sym_b}",
        },
    )


async def _close_pairs(
    supervisor: Any,
    db: AsyncSession,
    user: User,
    strategy: Strategy,
    state: Any,
    sym_a: str,
    sym_b: str,
    px_a: float,
    px_b: float,
    reason: str,
) -> None:
    amt_a = state.position_amount or 0.0
    amt_b = float(state.hedge_extreme or 0.0) if state.hedge_open else amt_a
    if amt_a <= 0:
        supervisor._clear_position(state)
        return

    side = state.position_side
    # Reverse of open.
    close_a = "sell" if side == "long" else "buy"
    close_b = "buy" if side == "long" else "sell"
    pos_a = "long" if side == "long" else "short"
    pos_b = "short" if side == "long" else "long"
    entry_a = state.entry_price or px_a
    entry_b = state.hedge_entry_price or px_b

    if state.mode == "live":
        fa = await place_market_leg(
            user,
            strategy,
            market="futures",
            symbol=sym_a,
            side=close_a,
            amount=amt_a,
            position_side=pos_a,
            reduce_only=True,
        )
        fb = await place_market_leg(
            user,
            strategy,
            market="futures",
            symbol=sym_b,
            side=close_b,
            amount=amt_b,
            position_side=pos_b,
            reduce_only=True,
        )
        if side == "long":
            pnl_a = (fa - entry_a) * amt_a
            pnl_b = (entry_b - fb) * amt_b
        else:
            pnl_a = (entry_a - fa) * amt_a
            pnl_b = (fb - entry_b) * amt_b
    else:
        fa = paper_fill_price(px_a, close_a)
        fb = paper_fill_price(px_b, close_b)
        if side == "long":
            pnl_a = (fa - entry_a) * amt_a
            pnl_b = (entry_b - fb) * amt_b
        else:
            pnl_a = (entry_a - fa) * amt_a
            pnl_b = (fb - entry_b) * amt_b

    await supervisor._settle_open_trade(db, strategy.id, "a", pnl_a)
    await supervisor._settle_open_trade(db, strategy.id, "b", pnl_b)
    supervisor._clear_position(state)
    await db.commit()
    total = pnl_a + pnl_b
    await publish_user_event(
        user.id,
        {
            "type": "trade_closed",
            "strategy_id": strategy.id,
            "strategy": strategy.name,
            "pnl": total,
            "reason": reason,
        },
    )


async def close_arb_position(supervisor: Any, db: AsyncSession, user: User, strategy: Strategy, state: Any) -> bool:
    """Flatten an open arb book (carry or pairs). Returns True if a position was closed."""
    if state is None or not state.has_position:
        return False
    cfg = strategy.config_json
    kind = strategy_kind(cfg)
    if kind == "cash_and_carry":
        sym = cfg.get("symbol", "BTC/USDT")
        spot = await _redis_price(sym) or state.entry_price or 0.0
        await _close_carry(supervisor, db, user, strategy, state, sym, spot, "manual")
        return True
    if kind == "pairs":
        sym_a = cfg.get("symbol_a") or cfg.get("symbol", "BTC/USDT")
        sym_b = cfg.get("symbol_b", "ETH/USDT")
        px_a = await _redis_price(sym_a) or state.entry_price or 0.0
        px_b = await _redis_price(sym_b) or state.hedge_entry_price or 0.0
        await _close_pairs(supervisor, db, user, strategy, state, sym_a, sym_b, px_a, px_b, "manual")
        return True
    return False
