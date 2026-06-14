from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.strategy import Strategy
from app.models.trade import Trade
from app.models.user import User
from app.schemas.trade import TradeOut, TradeStatsOut

router = APIRouter()


@router.get("/stats", response_model=TradeStatsOut)
async def trade_stats(
    mode: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TradeStatsOut:
    """Aggregate performance across the user's trades. Pass ?mode=paper or ?mode=live
    to filter by trading mode. Hedge legs are reported separately."""
    user_strategies = select(Strategy.id).where(Strategy.user_id == current_user.id).scalar_subquery()
    in_user = Trade.strategy_id.in_(user_strategies)
    is_main = Trade.leg != "hedge"

    filters = [in_user]
    if mode in ("paper", "live"):
        filters.append(Trade.mode == mode)

    row = (
        await db.execute(
            select(
                func.count(Trade.id).filter(is_main),
                func.count(Trade.pnl).filter(is_main),
                func.coalesce(func.sum(case((Trade.pnl > 0, 1), else_=0)).filter(is_main), 0),
                func.avg(Trade.pnl).filter(is_main),
                func.sum(Trade.pnl).filter(is_main),
                func.max(Trade.pnl).filter(is_main),
                func.min(Trade.pnl).filter(is_main),
                func.coalesce(func.sum(case((Trade.leg == "hedge", 1), else_=0)), 0),
            ).where(*filters)
        )
    ).one()
    total, closed, wins, avg_pnl, total_pnl, best, worst, hedge = row
    return TradeStatsOut(
        total_trades=int(total or 0),
        closed_trades=int(closed or 0),
        wins=int(wins or 0),
        win_rate=(float(wins) / closed * 100) if closed else 0.0,
        avg_pnl=float(avg_pnl or 0.0),
        total_pnl=float(total_pnl or 0.0),
        best_pnl=float(best or 0.0),
        worst_pnl=float(worst or 0.0),
        hedge_trades=int(hedge or 0),
    )


@router.get("", response_model=list[TradeOut])
async def list_trades(
    strategy_id: int | None = None,
    mode: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[TradeOut]:
    if strategy_id:
        strategy_ids = [strategy_id]
    else:
        strategy_ids = list((await db.scalars(select(Strategy.id).where(Strategy.user_id == current_user.id))).all())
    if not strategy_ids:
        return []
    q = select(Trade).where(Trade.strategy_id.in_(strategy_ids))
    if mode in ("paper", "live"):
        q = q.where(Trade.mode == mode)
    rows = (await db.execute(q.order_by(Trade.timestamp.desc()).limit(200))).scalars()
    return [TradeOut.model_validate(row) for row in rows]


@router.delete("", status_code=200)
async def reset_trades(
    strategy_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, int]:
    if strategy_id is not None:
        owned = await db.scalar(
            select(Strategy.id).where(Strategy.id == strategy_id, Strategy.user_id == current_user.id)
        )
        if owned is None:
            raise HTTPException(status_code=404, detail="Strategy not found")
        ids = [strategy_id]
    else:
        ids = list(
            (await db.scalars(select(Strategy.id).where(Strategy.user_id == current_user.id))).all()
        )
    if not ids:
        return {"deleted": 0}
    result = await db.execute(delete(Trade).where(Trade.strategy_id.in_(ids)))
    await db.commit()
    return {"deleted": result.rowcount}
