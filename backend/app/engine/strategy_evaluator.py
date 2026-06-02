from typing import Any

from app.services.indicators import rsi, sma


def evaluate_signal(config: dict[str, Any], closes: list[float], has_position: bool) -> str | None:
    if not closes:
        return None
    entry_rules = config.get("entry", [])
    exit_rules = config.get("exit", [])
    for rule in entry_rules:
        if rule.get("type") == "ma_cross":
            fast = sma(closes, int(rule.get("fast", 9)))
            slow = sma(closes, int(rule.get("slow", 21)))
            if fast is not None and slow is not None and fast > slow and not has_position:
                return "buy"
    for rule in exit_rules:
        if rule.get("type") == "rsi":
            value = rsi(closes, 14)
            threshold = float(rule.get("value", 70))
            op = rule.get("op", ">")
            if value is None:
                continue
            if (op == ">" and value > threshold or op == "<" and value < threshold) and has_position:
                return "sell"
    return None
