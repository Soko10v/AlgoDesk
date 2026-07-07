from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal, get_db
from app.core.deps import current_plan, get_current_user
from app.core.plans import FEATURE_MIN_PLAN, allows
from app.engine.risk import is_futures
from app.models.strategy import Strategy
from app.models.user import User
from app.schemas.strategy import BotControlIn
from app.workers.bot_supervisor import bot_supervisor

router = APIRouter()


@router.post("/{strategy_id}/start")
async def start_bot(
    strategy_id: int,
    payload: BotControlIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    plan: str = Depends(current_plan),
) -> dict:
    strategy = await db.get(Strategy, strategy_id)
    if strategy is None or strategy.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Strategy not found")
    # Trading (paper or live) is a paid feature.
    feature = "live" if payload.mode == "live" else "paper"
    if not allows(plan, feature):
        raise HTTPException(
            status_code=402,
            detail={"error": "upgrade_required", "feature": feature, "required_plan": FEATURE_MIN_PLAN[feature], "plan": plan},
        )
    if payload.mode == "live":
        # A single exchange account holds one position per symbol (one-way mode) and
        # leverage is per-symbol — so two live bots on the same symbol would merge
        # into one position and fight over leverage. Block that.
        sym = strategy.config_json.get("symbol")
        fut = is_futures(strategy.config_json)
        others = (
            await db.execute(
                select(Strategy).where(
                    Strategy.user_id == current_user.id,
                    Strategy.id != strategy.id,
                    Strategy.status == "live",
                )
            )
        ).scalars().all()
        clash = next(
            (s for s in others if s.config_json.get("symbol") == sym and is_futures(s.config_json) == fut),
            None,
        )
        if clash is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"“{clash.name}” is already trading {sym} live. Two live bots on the same "
                    "symbol and account merge into one exchange position and conflict on leverage. "
                    "Stop it first, or use a different symbol."
                ),
            )
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


@router.post("/panic")
async def panic_close_all(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Emergency stop: halt every running bot and market-close all live futures
    positions for the current user."""
    return await bot_supervisor.panic_close_all(db, current_user)


@router.post("/{strategy_id}/close-position")
async def close_position(
    strategy_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Market-close one strategy's live position now and clear its open records."""
    strategy = await db.get(Strategy, strategy_id)
    if strategy is None or strategy.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return await bot_supervisor.close_position(db, current_user, strategy)


@router.post("/{strategy_id}/sync-position")
async def sync_position(
    strategy_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Reconcile a strategy's open position with the exchange.

    Used when a position was closed on the exchange while the bot wasn't watching:
    if the exchange still shows a real position the bot resumes tracking it,
    otherwise the dangling open record is removed so it stops showing as open.
    Idempotent — running it again with nothing to reconcile is a no-op."""
    strategy = await db.get(Strategy, strategy_id)
    if strategy is None or strategy.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return await bot_supervisor.sync_strategy(db, current_user, strategy)
