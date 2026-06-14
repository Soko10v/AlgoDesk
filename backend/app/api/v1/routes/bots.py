from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal, get_db
from app.core.deps import get_current_user
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
