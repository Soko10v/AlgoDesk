from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.engine.risk import MAX_LEVERAGE

ALLOWED_TIMEFRAMES = frozenset({"5m", "15m", "1h", "4h", "1d"})
ALLOWED_MARKETS = frozenset({"spot", "futures"})
ALLOWED_HEDGE_MODES = frozenset({"auto_squeeze", "constant_partial"})
ALLOWED_DIRECTIONS = frozenset({"long", "both"})
ALLOWED_ENTRY_TYPES = frozenset({"ma_cross", "ema_cross", "rsi", "breakout", "macd"})


def _positive_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0


def validate_strategy_config(value: dict[str, Any]) -> dict[str, Any]:
    required = ["symbol", "timeframe", "entry", "exit", "stop_loss", "take_profit"]
    for key in required:
        if key not in value:
            raise ValueError(f"Missing strategy config field: {key}")
    # Position size can be a fixed USD notional (preferred) or, for strategies
    # saved before the switch to dollars, a percent of balance. Require one.
    if not (_positive_number(value.get("position_size_usdt")) or _positive_number(value.get("position_size_pct"))):
        raise ValueError("Set a position size: position_size_usdt (USD) or position_size_pct (%)")
    tf = value.get("timeframe")
    if tf not in ALLOWED_TIMEFRAMES:
        raise ValueError(f"Unsupported timeframe: {tf}")

    entry = value.get("entry") or []
    if entry:
        etype = entry[0].get("type") if isinstance(entry[0], dict) else None
        if etype is not None and etype not in ALLOWED_ENTRY_TYPES:
            raise ValueError(f"Unsupported entry type: {etype}")

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
    position_size_usdt: float | None = Field(default=None, gt=0)
