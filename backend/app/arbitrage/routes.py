"""Arbitrage API: opportunity scanner + deploy carry/pairs bots."""

from __future__ import annotations

import time
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import get_current_user
from app.arbitrage.kinds import default_carry_config, default_pairs_config, is_arb_config
from app.arbitrage.opportunities import scan_all
from app.arbitrage.scanner import get_cached_opportunities
from app.models.strategy import Strategy
from app.models.user import User
from app.schemas.strategy import StrategyOut

router = APIRouter()


class CarryDeployIn(BaseModel):
    symbol: str = Field(min_length=3, max_length=32)
    position_size_usdt: float = Field(gt=0, le=100_000)
    funding_entry_apr: float = Field(default=15.0, ge=0, le=500)
    funding_exit_apr: float = Field(default=5.0, ge=-50, le=500)
    basis_min_pct: float | None = Field(default=-0.5)
    leverage: int = Field(default=2, ge=1, le=10)
    name: str | None = Field(default=None, max_length=255)


class PairsDeployIn(BaseModel):
    symbol_a: str = Field(min_length=3, max_length=32)
    symbol_b: str = Field(min_length=3, max_length=32)
    position_size_usdt: float = Field(gt=0, le=100_000)
    timeframe: Literal["5m", "15m", "1h", "4h", "1d"] = "1h"
    lookback: int = Field(default=48, ge=10, le=500)
    z_entry: float = Field(default=2.0, gt=0, le=10)
    z_exit: float = Field(default=0.5, gt=0, le=10)
    leverage: int = Field(default=2, ge=1, le=10)
    name: str | None = Field(default=None, max_length=255)


@router.get("/opportunities")
async def opportunities(
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Cached scanner snapshot (funding/basis + educational triangular)."""
    _ = current_user
    snap = await get_cached_opportunities()
    if snap is None:
        # Cold start / Redis miss — compute once inline so the page isn't empty.
        try:
            snap = await scan_all()
            snap["updated_at"] = time.time()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=503, detail=f"Scanner unavailable: {exc}") from exc
    return snap


@router.get("/bots", response_model=list[StrategyOut])
async def list_arb_bots(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[StrategyOut]:
    items = (await db.execute(select(Strategy).where(Strategy.user_id == current_user.id))).scalars().all()
    return [StrategyOut.model_validate(s) for s in items if is_arb_config(s.config_json)]


@router.post("/carry", response_model=StrategyOut)
async def deploy_carry(
    payload: CarryDeployIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StrategyOut:
    cfg = default_carry_config(payload.symbol, payload.position_size_usdt)
    cfg["funding_entry_apr"] = payload.funding_entry_apr
    cfg["funding_exit_apr"] = payload.funding_exit_apr
    cfg["basis_min_pct"] = payload.basis_min_pct
    cfg["leverage"] = payload.leverage
    name = payload.name or f"Carry · {payload.symbol}"
    item = Strategy(user_id=current_user.id, name=name, config_json=cfg)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return StrategyOut.model_validate(item)


@router.post("/pairs", response_model=StrategyOut)
async def deploy_pairs(
    payload: PairsDeployIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StrategyOut:
    if payload.symbol_a == payload.symbol_b:
        raise HTTPException(status_code=400, detail="symbol_a and symbol_b must differ")
    if payload.z_exit >= payload.z_entry:
        raise HTTPException(status_code=400, detail="z_exit must be lower than z_entry")
    cfg = default_pairs_config(payload.symbol_a, payload.symbol_b, payload.position_size_usdt)
    cfg["timeframe"] = payload.timeframe
    cfg["lookback"] = payload.lookback
    cfg["z_entry"] = payload.z_entry
    cfg["z_exit"] = payload.z_exit
    cfg["leverage"] = payload.leverage
    name = payload.name or f"Pairs · {payload.symbol_a.split('/')[0]}/{payload.symbol_b.split('/')[0]}"
    item = Strategy(user_id=current_user.id, name=name, config_json=cfg)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return StrategyOut.model_validate(item)


@router.get("/strategies")
async def list_strategies_by_kind(
    kind: Literal["arb", "directional", "all"] = Query(default="all"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[StrategyOut]:
    items = (await db.execute(select(Strategy).where(Strategy.user_id == current_user.id))).scalars().all()
    if kind == "arb":
        items = [s for s in items if is_arb_config(s.config_json)]
    elif kind == "directional":
        items = [s for s in items if not is_arb_config(s.config_json)]
    return [StrategyOut.model_validate(s) for s in items]
