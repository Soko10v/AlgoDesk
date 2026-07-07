from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request
from sqlalchemy import String, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import require_admin
from app.core.ratelimit import limiter
from app.models.event import Event
from app.models.user import User
from app.schemas.event import AnalyticsSummaryOut, EventIn, EventTotalOut, FunnelStepOut

router = APIRouter()

# Ordered onboarding funnel — labels are what the admin summary shows.
FUNNEL_STEPS = [
    ("page_view", "Зашёл на сайт"),
    ("signup_success", "Зарегистрировался"),
    ("backtest_run", "Запустил бэктест"),
    ("subscription_view", "Открыл страницу оплаты"),
    ("checkout_started", "Начал оплату"),
]


@router.post("/event", status_code=204)
@limiter.limit("60/minute")
async def track_event(
    request: Request,
    payload: EventIn,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Public ingestion endpoint — fires from the frontend, logged in or not,
    so it stays unauthenticated and only rate-limited against abuse."""
    db.add(
        Event(
            name=payload.name,
            anon_id=payload.anon_id,
            path=payload.path,
            properties_json=payload.properties,
        )
    )
    await db.commit()


@router.get("/summary", response_model=AnalyticsSummaryOut)
async def analytics_summary(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> AnalyticsSummaryOut:
    since = datetime.now(UTC) - timedelta(days=max(1, min(days, 365)))
    # A visitor is identified by anon_id pre-login, user_id post-login — merge them
    # into one key so the same person isn't double-counted across the funnel.
    identity = func.coalesce(Event.anon_id, cast(Event.user_id, String))

    async def unique_count(name: str) -> int:
        result = await db.execute(
            select(func.count(func.distinct(identity))).where(
                Event.name == name, Event.created_at >= since
            )
        )
        return result.scalar_one() or 0

    funnel: list[FunnelStepOut] = []
    first_count: int | None = None
    for name, label in FUNNEL_STEPS:
        count = await unique_count(name)
        if first_count is None:
            first_count = count
        pct = round(count / first_count * 100, 1) if first_count else None
        funnel.append(FunnelStepOut(name=name, label=label, unique_users=count, conversion_pct=pct))

    totals_rows = (
        await db.execute(
            select(Event.name, func.count(Event.id), func.count(func.distinct(identity)))
            .where(Event.created_at >= since)
            .group_by(Event.name)
            .order_by(func.count(Event.id).desc())
        )
    ).all()
    totals = [EventTotalOut(name=row[0], count=row[1], unique_users=row[2]) for row in totals_rows]

    return AnalyticsSummaryOut(since=since, funnel=funnel, totals=totals)
