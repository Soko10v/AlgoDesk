from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.strategy import Strategy
from app.models.trade import Trade
from app.models.user import User
from app.schemas.trade import TradeOut

router = APIRouter()


@router.get("", response_model=list[TradeOut])
async def list_trades(
    strategy_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[TradeOut]:
    if strategy_id:
        strategy_ids = [strategy_id]
    else:
        strategy_ids = list((await db.scalars(select(Strategy.id).where(Strategy.user_id == current_user.id))).all())
    if not strategy_ids:
        return []
    rows = (
        await db.execute(
            select(Trade)
            .where(Trade.strategy_id.in_(strategy_ids))
            .order_by(Trade.timestamp.desc())
            .limit(200)
        )
    ).scalars()
    return [TradeOut.model_validate(row) for row in rows]
