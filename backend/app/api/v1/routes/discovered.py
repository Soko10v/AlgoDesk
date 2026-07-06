from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.discovered import DiscoveredStrategy
from app.models.user import User
from app.schemas.discovered import DiscoveredOut

router = APIRouter()


@router.get("", response_model=list[DiscoveredOut])
async def list_discovered(
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> list[DiscoveredStrategy]:
    """The auto-discovered "best strategies" board — same for every user, rebuilt
    server-side every couple of days. Available on every plan: it's the beginner
    on-ramp (pick a ready strategy, backtest it, then upgrade to run it live)."""
    rows = (
        await db.execute(select(DiscoveredStrategy).order_by(DiscoveredStrategy.rank))
    ).scalars().all()
    return list(rows)
