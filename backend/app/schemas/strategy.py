from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.engine.risk import MAX_LEVERAGE

ALLOWED_TIMEFRAMES = frozenset({"5m", "15m", "1h", "4h", "1d"})
ALLOWED_MARKETS = frozenset({"spot", "futures"})
ALLOWED_HEDGE_MODES = frozenset({"auto_squeeze", "constant_partial"})
ALLOWED_DIRECTIONS = frozenset({"long", "both"})


def validate_strategy_config(value: dict[str, Any]) -> dict[str, Any]:
    required = ["symbol", "timeframe", "position_size_pct", "entry", "exit", "stop_loss", "take_profit"]
    for key in required:
        if key not in value:
            raise ValueError(f"Missing strategy config field: {key}")
    tf = value.get("timeframe")
    if tf not in ALLOWED_TIMEFRAMES:
        raise ValueError(f"Unsupported timeframe: {tf}")

    # market defaults to spot so strategies saved before futures support stay valid.
    market = value.get("market", "spot")
    if market not in ALLOWED_MARKETS:
        raise ValueError(f"Unsupported market: {market}")
    if market == "futures":
        _validate_futures(value)
    return value


def _validate_futures(value: dict[str, Any]) -> None:
    lev = value.get("leverage", 1)
    try:
        lev = int(lev)
    except (TypeError, ValueError):
        raise ValueError("leverage must be an integer") from None
    if not 1 <= lev <= MAX_LEVERAGE:
        raise ValueError(f"leverage must be between 1 and {MAX_LEVERAGE}")

    direction = value.get("direction", "long")
    if direction not in ALLOWED_DIRECTIONS:
        raise ValueError("direction must be 'long' or 'both'")

    hedge = value.get("hedge")
    if hedge is None:
        return
    if not isinstance(hedge, dict):
        raise ValueError("hedge must be an object")
    if hedge.get("enabled") and hedge.get("mode") not in ALLOWED_HEDGE_MODES:
        raise ValueError("hedge.mode must be 'auto_squeeze' or 'constant_partial'")


class StrategyBase(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    config_json: dict[str, Any]
    live_enabled: bool = False

    @field_validator("config_json")
    @classmethod
    def validate_config(cls, value: dict[str, Any]) -> dict[str, Any]:
        return validate_strategy_config(value)


class StrategyCreateIn(StrategyBase):
    pass


class StrategyUpdateIn(BaseModel):
    name: str | None = None
    config_json: dict[str, Any] | None = None
    status: str | None = None
    live_enabled: bool | None = None

    @field_validator("config_json")
    @classmethod
    def validate_config(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is None:
            return value
        return validate_strategy_config(value)


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
