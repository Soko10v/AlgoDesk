"""AI analysis of a backtest via DeepSeek (OpenAI-compatible chat completions).

Sends the strategy config + an aggregated view of the backtest (win/loss stats,
breakdown by exit reason, best/worst trades) and asks for a plain-language verdict,
practical advice and an improved strategy config. The API key stays server-side.
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


async def analyze_strategy(config: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    """Call DeepSeek to analyse a backtest. Raises RuntimeError on config/transport
    errors so the route can surface a clean message."""
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
    payload = {
        "model": settings.deepseek_model,
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": "Данные стратегии и бэктеста (JSON):\n" + json.dumps(summary, ensure_ascii=False)},
        ],
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
    except Exception as exc:  # noqa: BLE001 - transport/HTTP error
        logger.warning("DeepSeek request failed: %s", exc)
        raise RuntimeError("AI request failed") from exc

    content = data["choices"][0]["message"]["content"]
    try:
        parsed = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        # Model didn't return clean JSON — surface the text as the assessment.
        return {"verdict": "AI-анализ", "rating": "mixed", "assessment": str(content),
                "proposed_changes": "", "proposed_config": None}

    proposed = parsed.get("proposed_config")
    if isinstance(proposed, dict):
        # Keep the proposal comparable: same coin and timeframe as the original.
        proposed["symbol"] = config.get("symbol")
        proposed["timeframe"] = config.get("timeframe")
        try:
            validate_strategy_config(proposed)
        except Exception:  # noqa: BLE001 - drop an invalid proposal, keep the text
            proposed = None
    else:
        proposed = None

    rating = parsed.get("rating")
    return {
        "verdict": str(parsed.get("verdict") or ""),
        "rating": rating if rating in ("good", "mixed", "bad") else "mixed",
        "assessment": str(parsed.get("assessment") or ""),
        "proposed_changes": str(parsed.get("proposed_changes") or ""),
        "proposed_config": proposed,
    }
