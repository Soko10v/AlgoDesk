from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Strategy(Base):
    __tablename__ = "strategies"
    __table_args__ = (UniqueConstraint("id", "user_id", name="uq_strategy_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    # Any strategy can run live once the account's plan unlocks it (see
    # FEATURE_MIN_PLAN["live"]) — there is no separate per-strategy opt-in.
    status: Mapped[str] = mapped_column(String(32), default="stopped")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="strategies")
    trades = relationship("Trade", back_populates="strategy", cascade="all, delete-orphan")
