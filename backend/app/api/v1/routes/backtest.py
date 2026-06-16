from datetime import datetime, time

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.ratelimit import limiter
from app.models.strategy import Strategy
from app.models.user import User
from app.schemas.backtest import (
    AnalyzeIn,
    AnalyzeStartOut,
    AnalyzeStatusOut,
    BacktestIn,
    BacktestOut,
    OptimizeIn,
    OptimizeOut,
)
from app.services.ai_analysis import is_configured
from app.services.ai_jobs import get_job, start_job
from app.services.backtest import run_backtest, run_optimization

router = APIRouter()


def _date_bounds(start_date, end_date) -> tuple[int | None, int | None]:
    since_ms = int(datetime.combine(start_date, time.min).timestamp() * 1000) if start_date else None
    until_ms = int(datetime.combine(end_date, time.max).timestamp() * 1000) if end_date else None
    return since_ms, until_ms


@router.post("", response_model=BacktestOut)
@limiter.limit("15/minute")
async def backtest_strategy(
    request: Request,
    payload: BacktestIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BacktestOut:
    strategy = await db.get(Strategy, payload.strategy_id)
    if strategy is None or strategy.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Strategy not found")
    since_ms, until_ms = _date_bounds(payload.start_date, payload.end_date)
    data = await run_backtest(strategy.config_json, since_ms=since_ms, until_ms=until_ms)
    return BacktestOut(**data)


@router.post("/optimize", response_model=OptimizeOut)
@limiter.limit("6/minute")
async def optimize_strategy(
    request: Request,
    payload: OptimizeIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OptimizeOut:
    strategy = await db.get(Strategy, payload.strategy_id)
    if strategy is None or strategy.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Strategy not found")
    since_ms, until_ms = _date_bounds(payload.start_date, payload.end_date)
    data = await run_optimization(strategy.config_json, since_ms=since_ms, until_ms=until_ms)
    return OptimizeOut(**data)


@router.post("/analyze", response_model=AnalyzeStartOut)
@limiter.limit("6/minute")
async def analyze_backtest(
    request: Request,
    payload: AnalyzeIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnalyzeStartOut:
    """Kick off the iterative AI analysis as a background job and return its id.

    The work (several backtests + DeepSeek calls) can take a couple of minutes,
    so the client polls ``/analyze/{job_id}`` instead of holding one long request.
    """
    strategy = await db.get(Strategy, payload.strategy_id)
    if strategy is None or strategy.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Strategy not found")
    if not is_configured():
        raise HTTPException(status_code=503, detail="AI analysis is not configured (set DEEPSEEK_API_KEY)")
    since_ms, until_ms = _date_bounds(payload.start_date, payload.end_date)
    job_id = start_job(current_user.id, strategy.config_json, since_ms, until_ms)
    return AnalyzeStartOut(job_id=job_id)


@router.get("/analyze/{job_id}", response_model=AnalyzeStatusOut)
async def analyze_status(
    job_id: str,
    current_user: User = Depends(get_current_user),
) -> AnalyzeStatusOut:
    job = get_job(job_id)
    if job is None or job.get("user_id") != current_user.id:
        raise HTTPException(status_code=404, detail="Analysis job not found")
    return AnalyzeStatusOut(
        status=job["status"],
        attempt=job.get("attempt", 1),
        result=job.get("result"),
        error=job.get("error"),
    )
