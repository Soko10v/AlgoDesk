from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.strategy import Strategy
from app.models.user import User
from app.schemas.strategy import StrategyCreateIn, StrategyOut, StrategyUpdateIn

router = APIRouter()


@router.get("", response_model=list[StrategyOut])
async def list_strategies(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[StrategyOut]:
    items = (await db.execute(select(Strategy).where(Strategy.user_id == current_user.id))).scalars().all()
    return [StrategyOut.model_validate(item) for item in items]


@router.post("", response_model=StrategyOut)
async def create_strategy(
    payload: StrategyCreateIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StrategyOut:
    item = Strategy(user_id=current_user.id, **payload.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return StrategyOut.model_validate(item)


@router.put("/{strategy_id}", response_model=StrategyOut)
async def update_strategy(
    strategy_id: int,
    payload: StrategyUpdateIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StrategyOut:
    item = await db.get(Strategy, strategy_id)
    if item is None or item.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Strategy not found")
    for key, value in payload.model_dump(exclude_none=True).items():
        setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    return StrategyOut.model_validate(item)


@router.delete("/{strategy_id}")
async def delete_strategy(
    strategy_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    item = await db.get(Strategy, strategy_id)
    if item is None or item.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Strategy not found")
    await db.delete(item)
    await db.commit()
    return {"ok": True}
