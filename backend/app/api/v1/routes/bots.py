from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal, get_db
from app.core.deps import get_current_user
from app.engine.risk import is_futures
from app.models.strategy import Strategy
from app.models.trade import Trade
from app.models.user import User
from app.schemas.strategy import BotControlIn
from app.services.exchange import exchange_client, perp_symbol
from app.workers.bot_supervisor import bot_supervisor

router = APIRouter()


@router.post("/{strategy_id}/start")
async def start_bot(
    strategy_id: int,
    payload: BotControlIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    strategy = await db.get(Strategy, strategy_id)
    if strategy is None or strategy.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Strategy not found")
    if payload.mode == "live" and not strategy.live_enabled:
        raise HTTPException(status_code=400, detail="Live mode disabled for this strategy")
    await bot_supervisor.start(SessionLocal, strategy.id, payload.mode, position_size_usdt=payload.position_size_usdt)
    strategy.status = payload.mode
    await db.commit()
    return {"ok": True}


@router.post("/{strategy_id}/stop")
async def stop_bot(
    strategy_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    strategy = await db.get(Strategy, strategy_id)
    if strategy is None or strategy.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Strategy not found")
    await bot_supervisor.stop(strategy.id)
    strategy.status = "stopped"
    await db.commit()
    return {"ok": True}


@router.post("/{strategy_id}/sync-position")
async def sync_position(
    strategy_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Force-close any open (pnl=NULL) trade records for a strategy.
    Used when a live position was manually closed on the exchange while the bot
    wasn't watching — writes a synthetic close record so the feed shows the
    trade as done and stops displaying it as open."""
    strategy = await db.get(Strategy, strategy_id)
    if strategy is None or strategy.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Strategy not found")

    open_trades = (
        await db.execute(
            select(Trade).where(Trade.strategy_id == strategy_id, Trade.pnl.is_(None))
        )
    ).scalars().all()

    # Best-effort: fetch current price to calculate approximate PnL.
    current_price = 0.0
    if current_user.exchange:
        try:
            symbol = strategy.config_json.get("symbol", "BTC/USDT")
            futures = is_futures(strategy.config_json)
            trade_symbol = perp_symbol(symbol) if futures else symbol
            market = "futures" if futures else "spot"
            client = exchange_client(current_user.exchange, current_user, market_type=market)
            try:
                ticker = await client.fetch_ticker(trade_symbol)
                current_price = float(ticker.get("last") or 0.0)
            finally:
                await client.close()
        except Exception:
            pass

    now = datetime.now(UTC)
    for open_trade in open_trades:
        entry_price = open_trade.price
        position_side = "long" if open_trade.side == "buy" else "short"
        close_side = "sell" if position_side == "long" else "buy"
        fill = current_price if current_price > 0 else entry_price
        if entry_price > 0:
            pnl = ((fill - entry_price) / entry_price * 100) if position_side == "long" else ((entry_price - fill) / entry_price * 100)
        else:
            pnl = 0.0
        db.add(Trade(
            strategy_id=strategy_id,
            symbol=open_trade.symbol,
            side=close_side,
            price=fill,
            amount=open_trade.amount,
            pnl=round(pnl, 4),
            leg=open_trade.leg,
            mode=open_trade.mode,
            timestamp=now,
        ))

    await db.commit()

    # Clear in-memory position state if the bot is still loaded.
    state = bot_supervisor.states.get(strategy_id)
    if state:
        state.position_side = None
        state.position_amount = None
        state.entry_price = None
        state.extreme_price = None
        state.stop_order_id = None
        state.hedge_open = False
        state.hedge_side = None
        state.hedge_entry_price = None

    return {"closed": len(open_trades)}
