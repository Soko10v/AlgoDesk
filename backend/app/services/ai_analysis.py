"""AI analysis of a backtest via DeepSeek (OpenAI-compatible chat completions).

Sends the strategy config + aggregated backtest stats and asks for a plain-language
verdict and an improved config. Iterative mode backtests each proposal and retries
(up to 3 times) when the suggestion doesn't beat the original.
"""

import json
import logging
from typing import Any

import httpx

from app.core.config import get_settings
from app.engine.risk import leverage
from app.schemas.strategy import validate_strategy_config

logger = logging.getLogger(__name__)
settings = get_settings()


def is_configured() -> bool:
    return bool(settings.deepseek_api_key)


def _slim(t: dict[str, Any]) -> dict[str, Any]:
    return {
        "side": t.get("side"),
        "price": t.get("price"),
        "pnl_pct": round(float(t["pnl_pct"]), 3),
        "reason": t.get("reason"),
    }


def _trade_summary(result: dict[str, Any]) -> dict[str, Any]:
    trades = result.get("trades", [])
    closed = [t for t in trades if t.get("leg") != "hedge" and isinstance(t.get("pnl_pct"), (int, float))]
    wins = [t for t in closed if t["pnl_pct"] > 0]
    losses = [t for t in closed if t["pnl_pct"] <= 0]

    def avg(xs: list[dict[str, Any]]) -> float:
        return round(sum(x["pnl_pct"] for x in xs) / len(xs), 3) if xs else 0.0

    by_reason: dict[str, dict[str, Any]] = {}
    for t in closed:
        b = by_reason.setdefault(str(t.get("reason", "?")), {"count": 0, "pnl_pct": 0.0})
        b["count"] += 1
        b["pnl_pct"] = round(b["pnl_pct"] + t["pnl_pct"], 2)

    return {
        "closed_trades": len(closed),
        "wins": len(wins),
        "losses": len(losses),
        "avg_win_pct": avg(wins),
        "avg_loss_pct": avg(losses),
        "by_exit_reason": by_reason,
        "best": [_slim(t) for t in sorted(closed, key=lambda t: t["pnl_pct"], reverse=True)[:5]],
        "worst": [_slim(t) for t in sorted(closed, key=lambda t: t["pnl_pct"])[:5]],
    }


_SYSTEM = """\
Ты — опытный количественный аналитик торговых стратегий для no-code крипто-бота.
Тебе дают конфиг стратегии и результаты её бэктеста (комиссии и фандинг уже учтены).

Поля конфига:
- symbol, timeframe, market ("spot"|"futures"), direction ("long"|"both"), leverage (1-10)
- position_size_usdt — это МАРЖА в USD; объём позиции = маржа × leverage
- entry: массив правил (ma_cross/ema_cross/rsi/breakout/macd), exit: правила RSI
- stop_loss/take_profit/trailing_stop: {type:"pct", value:n} (0 = выключено)
- hedge: настройки защитного шорта (фьючерс)
- daily_loss_limit_pct: дневной лимит убытка

Проанализируй: прибыльность, просадку, винрейт, частоту сделок, по каким причинам
закрываются сделки (стоп-лосс/тейк/трейлинг/сигнал), нет ли переторговли, не слишком
ли узкий стоп, оправдан ли риск. Дай конкретные практические советы и предложи
улучшенную версию конфига.

Отвечай ТОЛЬКО валидным JSON (на русском в текстовых полях) с ключами:
{
 "verdict": "одна короткая фраза — как дела у бота",
 "rating": "good" | "mixed" | "bad",
 "assessment": "разбор и советы, простым языком, можно списком через переносы строк",
 "proposed_changes": "что изменил в улучшенной версии и почему (кратко)",
 "proposed_config": { ...полный конфиг той же формы... } | null
}
В proposed_config сохрани те же symbol и timeframe; можешь менять entry/exit,
stop_loss/take_profit/trailing_stop, leverage, position_size_usdt, direction, hedge.
Если улучшить нечем — proposed_config: null.
"""


async def _call_deepseek_raw(messages: list[dict[str, str]]) -> str:
    """Post to DeepSeek chat completions and return the raw content string."""
    payload = {
        "model": settings.deepseek_model,
        "messages": messages,
        "response_format": {"type": "json_object"},
        "temperature": 0.4,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            resp = await client.post(
                f"{settings.deepseek_base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {settings.deepseek_api_key}"},
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("DeepSeek request failed: %s", exc)
        raise RuntimeError("AI request failed") from exc
    return data["choices"][0]["message"]["content"]


def _parse_proposed(parsed: dict[str, Any], config: dict[str, Any]) -> dict[str, Any] | None:
    """Extract and validate the proposed_config from a DeepSeek response."""
    proposed = parsed.get("proposed_config")
    if not isinstance(proposed, dict):
        return None
    proposed["symbol"] = config.get("symbol")
    proposed["timeframe"] = config.get("timeframe")
    try:
        validate_strategy_config(proposed)
        return proposed
    except Exception:  # noqa: BLE001
        return None


async def analyze_strategy(config: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    """Single-shot DeepSeek analysis (kept for backwards compatibility)."""
    if not is_configured():
        raise RuntimeError("AI analysis is not configured")

    summary = {
        "config": config,
        "leverage": leverage(config),
        "backtest": {
            "total_return_pct": round(float(result.get("total_return_pct", 0.0)), 2),
            "max_drawdown_pct": round(float(result.get("max_drawdown_pct", 0.0)), 2),
            "win_rate_pct": round(float(result.get("win_rate", 0.0)), 2),
            "candles": result.get("candles"),
        },
        "trades": _trade_summary(result),
    }
    messages: list[dict[str, str]] = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": "Данные стратегии и бэктеста (JSON):\n" + json.dumps(summary, ensure_ascii=False)},
    ]
    content = await _call_deepseek_raw(messages)
    try:
        parsed = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return {"verdict": "AI-анализ", "rating": "mixed", "assessment": str(content),
                "proposed_changes": "", "proposed_config": None}

    proposed = _parse_proposed(parsed, config)
    rating = parsed.get("rating")
    return {
        "verdict": str(parsed.get("verdict") or ""),
        "rating": rating if rating in ("good", "mixed", "bad") else "mixed",
        "assessment": str(parsed.get("assessment") or ""),
        "proposed_changes": str(parsed.get("proposed_changes") or ""),
        "proposed_config": proposed,
    }


async def analyze_strategy_iterative(
    config: dict[str, Any],
    original_result: dict[str, Any],
    since_ms: int | None = None,
    until_ms: int | None = None,
) -> dict[str, Any]:
    """Propose → backtest → compare → retry if worse. Up to 3 attempts total.

    Returns the best config found (if any beats the original) along with per-attempt
    metrics so the UI can show what was tried.
    """
    from app.services.backtest import run_backtest  # local import avoids circular dependency

    if not is_configured():
        raise RuntimeError("AI analysis is not configured")

    original_return = round(float(original_result.get("total_return_pct", 0.0)), 2)
    original_drawdown = round(float(original_result.get("max_drawdown_pct", 0.0)), 2)

    summary = {
        "config": config,
        "leverage": leverage(config),
        "backtest": {
            "total_return_pct": original_return,
            "max_drawdown_pct": original_drawdown,
            "win_rate_pct": round(float(original_result.get("win_rate", 0.0)), 2),
            "candles": original_result.get("candles"),
        },
        "trades": _trade_summary(original_result),
    }
    messages: list[dict[str, str]] = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": "Данные стратегии и бэктеста (JSON):\n" + json.dumps(summary, ensure_ascii=False)},
    ]

    attempts: list[dict[str, Any]] = []
    best_config: dict[str, Any] | None = None
    best_return: float = original_return
    best_drawdown: float = original_drawdown
    final_parsed: dict[str, Any] = {}

    for attempt_n in range(1, 4):
        try:
            raw = await _call_deepseek_raw(messages)
        except RuntimeError:
            break

        try:
            parsed = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            final_parsed = {
                "verdict": "AI-анализ", "rating": "mixed",
                "assessment": str(raw), "proposed_changes": "", "proposed_config": None,
            }
            break

        final_parsed = parsed
        proposed = _parse_proposed(parsed, config)

        if not proposed:
            # AI decided nothing can be improved (or returned invalid config).
            break

        try:
            prop_result = await run_backtest(proposed, since_ms=since_ms, until_ms=until_ms)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Backtest of proposed config attempt %d failed: %s", attempt_n, exc)
            break

        prop_return = round(float(prop_result.get("total_return_pct", 0.0)), 2)
        prop_drawdown = round(float(prop_result.get("max_drawdown_pct", 0.0)), 2)
        prop_winrate = round(float(prop_result.get("win_rate", 0.0)), 2)
        prop_trades = len([t for t in prop_result.get("trades", []) if isinstance(t.get("pnl_pct"), (int, float))])

        attempts.append({
            "n": attempt_n,
            "total_return_pct": prop_return,
            "max_drawdown_pct": prop_drawdown,
            "win_rate": prop_winrate,
            "trades": prop_trades,
            "proposed_changes": str(parsed.get("proposed_changes") or ""),
        })

        # "Better" = higher return, or same return with significantly lower drawdown.
        is_better = prop_return > original_return or (
            abs(prop_return - original_return) < 1.0 and prop_drawdown < original_drawdown * 0.75
        )

        if is_better:
            best_config = proposed
            best_return = prop_return
            best_drawdown = prop_drawdown
            break

        # Give feedback for the next attempt.
        messages.append({"role": "assistant", "content": raw})
        messages.append({
            "role": "user",
            "content": (
                f"Попытка {attempt_n}: бэктест дал return={prop_return:.1f}%, drawdown={prop_drawdown:.1f}% — "
                f"хуже оригинала (return={original_return:.1f}%, drawdown={original_drawdown:.1f}%). "
                f"Попробуй принципиально другой подход (другие индикаторы входа, уровни стопа/тейка). "
                f"Верни JSON в том же формате."
            ),
        })

    improved = best_config is not None
    rating = final_parsed.get("rating")

    return {
        "verdict": str(final_parsed.get("verdict") or ""),
        "rating": rating if rating in ("good", "mixed", "bad") else "mixed",
        "assessment": str(final_parsed.get("assessment") or ""),
        "proposed_changes": (
            attempts[-1]["proposed_changes"] if attempts else str(final_parsed.get("proposed_changes") or "")
        ),
        "proposed_config": best_config,
        "improved": improved,
        "attempts": attempts,
        "original_return_pct": original_return,
        "original_drawdown_pct": original_drawdown,
        "best_return_pct": best_return if improved else None,
        "best_drawdown_pct": best_drawdown if improved else None,
    }
