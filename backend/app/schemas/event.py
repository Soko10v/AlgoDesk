from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class EventIn(BaseModel):
    name: str = Field(max_length=64)
    anon_id: str | None = Field(default=None, max_length=64)
    path: str | None = Field(default=None, max_length=255)
    properties: dict[str, Any] = Field(default_factory=dict)


class FunnelStepOut(BaseModel):
    name: str
    label: str
    unique_users: int
    conversion_pct: float | None


class EventTotalOut(BaseModel):
    name: str
    count: int
    unique_users: int


class AnalyticsSummaryOut(BaseModel):
    since: datetime
    funnel: list[FunnelStepOut]
    totals: list[EventTotalOut]
