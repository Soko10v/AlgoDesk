from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Float, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class DiscoveredStrategy(Base):
    """A strategy the server found by brute-forcing entry/filter combinations over
    recent history. Global (not per-user) — the whole "best strategies" board is
    rebuilt on each discovery run, so rows are disposable: a run truncates the
    table and inserts the fresh top set."""

    __tablename__ = "discovered_strategies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    # Human-facing label built server-side so newcomers never see raw indicator jargon.
    title: Mapped[str] = mapped_column(String(120))
    subtitle: Mapped[str] = mapped_column(String(255))
    symbol: Mapped[str] = mapped_column(String(32))
    timeframe: Mapped[str] = mapped_column(String(8))
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    total_return_pct: Mapped[float] = mapped_column(Float, default=0.0)
    max_drawdown_pct: Mapped[float] = mapped_column(Float, default=0.0)
    win_rate: Mapped[float] = mapped_column(Float, default=0.0)
    trades: Mapped[int] = mapped_column(Integer, default=0)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    period_days: Mapped[int] = mapped_column(Integer, default=30)
    rank: Mapped[int] = mapped_column(Integer, default=0)
    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
