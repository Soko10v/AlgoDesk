from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator


class StrategyBase(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    config_json: dict[str, Any]
    live_enabled: bool = False

    @field_validator("config_json")
    @classmethod
    def validate_config(cls, value: dict[str, Any]) -> dict[str, Any]:
        required = ["symbol", "timeframe", "position_size_pct", "entry", "exit", "stop_loss", "take_profit"]
        for key in required:
            if key not in value:
                raise ValueError(f"Missing strategy config field: {key}")
        return value


class StrategyCreateIn(StrategyBase):
    pass


class StrategyUpdateIn(BaseModel):
    name: str | None = None
    config_json: dict[str, Any] | None = None
    status: str | None = None
    live_enabled: bool | None = None


class StrategyOut(BaseModel):
    id: int
    user_id: int
    name: str
    config_json: dict[str, Any]
    status: str
    live_enabled: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class BotControlIn(BaseModel):
    mode: str = Field(pattern="^(paper|live)$")
