from datetime import datetime, time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.strategy import Strategy
from app.models.user import User
from app.schemas.backtest import BacktestIn, BacktestOut
from app.services.backtest import run_backtest

router = APIRouter()


@router.post("", response_model=BacktestOut)
async def backtest_strategy(
    payload: BacktestIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BacktestOut:
    strategy = await db.get(Strategy, payload.strategy_id)
    if strategy is None or strategy.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Strategy not found")
    since_ms = None
    until_ms = None
    if payload.start_date:
        since_ms = int(datetime.combine(payload.start_date, time.min).timestamp() * 1000)
    if payload.end_date:
        until_ms = int(datetime.combine(payload.end_date, time.max).timestamp() * 1000)
    data = await run_backtest(strategy.config_json, since_ms=since_ms, until_ms=until_ms)
    return BacktestOut(**data)
