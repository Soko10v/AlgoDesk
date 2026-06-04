from typing import Any

from app.engine.risk import allow_short
from app.services.indicators import rsi, sma


def _ma_trend(config: dict[str, Any], closes: list[float]) -> tuple[bool, bool]:
    """Return (bullish, bearish) from the MA-cross entry rule."""
    bullish = bearish = False
    for rule in config.get("entry", []):
        if rule.get("type") == "ma_cross":
            fast = sma(closes, int(rule.get("fast", 9)))
            slow = sma(closes, int(rule.get("slow", 21)))
            if fast is not None and slow is not None:
                bullish = fast > slow
                bearish = fast < slow
    return bullish, bearish


def _rsi_exit(config: dict[str, Any], closes: list[float]) -> bool:
    for rule in config.get("exit", []):
        if rule.get("type") == "rsi":
            value = rsi(closes, 14)
            if value is None:
                continue
            threshold = float(rule.get("value", 70))
            op = rule.get("op", ">")
            if (op == ">" and value > threshold) or (op == "<" and value < threshold):
                return True
    return False


def evaluate_signal(config: dict[str, Any], closes: list[float], position_side: str | None) -> str | None:
    """Decide the next action given the open position.

    `position_side` is None (flat), "long" or "short". Returns one of:
      "long"  — open (or flip to) a long
      "short" — open (or flip to) a short
      "close" — close the current position to flat
      None    — hold

    Long-only strategies (spot, or futures with direction != "both") keep the
    original behaviour: enter long on a bullish MA cross, exit on the RSI rule.
    Futures bots with direction "both" follow the trend and flip on the opposite
    cross (RSI is not used — the MA cross drives the side, SL/TP still protect)."""
    if not closes:
        return None
    bullish, bearish = _ma_trend(config, closes)

    if allow_short(config):
        # Flip model: always sit on the trend side.
        if bullish and position_side != "long":
            return "long"
        if bearish and position_side != "short":
            return "short"
        return None

    # Long-only (unchanged semantics).
    if position_side is None:
        return "long" if bullish else None
    if position_side == "long" and _rsi_exit(config, closes):
        return "close"
    return None
