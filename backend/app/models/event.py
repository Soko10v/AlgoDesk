from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Event(Base):
    """A single analytics event — our own in-house replacement for a third-party
    tracker. Fired from the frontend at key funnel touchpoints (landing CTA,
    signup, first backtest, subscription view, checkout) plus from the backend
    where a step only exists server-side. No cookies, no external account: just
    an anonymous per-browser id (localStorage) that gets linked to a user id
    once they sign in."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(64), index=True)
    anon_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    properties_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
