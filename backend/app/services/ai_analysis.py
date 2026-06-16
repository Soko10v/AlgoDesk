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
- entry: массив правил (ma_cross/ema_cross/rsi/breakout/macd). ВАЖНО: движок берёт
  ТОЛЬКО ПЕРВОЕ правило массива — не добавляй второе правило как «фильтр».
- filters: массив доп. условий входа (работают реально, в отличие от второго entry):
  - {"type":"trend","ma":"ema"|"sma","period":N} — лонг только если цена ВЫШЕ MA,
    шорт только если НИЖЕ (фильтр тренда, напр. EMA 200)
  - {"type":"rsi","period":N,"max":X,"min":M} — не входить в лонг при RSI ≥ max
    (перекупленность), не входить в шорт при RSI ≤ min (перепроданность)
  Хочешь добавить подтверждение по тренду/импульсу — клади его в filters.
- exit: правила RSI
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
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{settings.deepseek_base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {settings.deepseek_api_key}"},
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        body = exc.response.text[:200] if exc.response is not None else ""
        logger.warning("DeepSeek HTTP %s: %s", exc.response.status_code, body)
        raise RuntimeError(f"DeepSeek error {exc.response.status_code}") from exc
    except Exception as exc:  # noqa: BLE001 - transport/timeout
        logger.warning("DeepSeek request failed: %s", exc)
        raise RuntimeError("AI request failed (network/timeout)") from exc
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
    candles: list[list[float]],
    progress_cb=None,
) -> dict[str, Any]:
    """Propose → backtest → compare, three times. Always produces three distinct
    variants so the user has options to compare and save.

    Every proposal is simulated on the SAME ``candles`` as the original (no extra
    network fetches), so the comparison is fair and fast. ``progress_cb(n)`` (if
    given) is called with the current attempt number for live progress.
    """
    from app.services.backtest import simulate_backtest  # local import avoids circular dependency

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
    final_parsed: dict[str, Any] = {}  # first usable response — holds the verdict/assessment
    last_error: str | None = None

    # Always produce three distinct variants so the user has options to compare and
    # save, even if an early one already beats the original.
    for attempt_n in range(1, 4):
        if progress_cb:
            progress_cb(attempt_n)
        try:
            raw = await _call_deepseek_raw(messages)
        except RuntimeError as exc:
            last_error = str(exc)
            break

        try:
            parsed = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            if not final_parsed:
                final_parsed = {
                    "verdict": "AI-анализ", "rating": "mixed",
                    "assessment": str(raw), "proposed_changes": "", "proposed_config": None,
                }
            messages.append({"role": "assistant", "content": raw})
            messages.append({"role": "user", "content": "Ответ был не в формате JSON. Верни строго валидный JSON с proposed_config."})
            continue

        if not final_parsed:
            final_parsed = parsed  # keep the first response's verdict/assessment/rating

        proposed = _parse_proposed(parsed, config)
        if not proposed:
            messages.append({"role": "assistant", "content": raw})
            messages.append({
                "role": "user",
                "content": (
                    f"Нужен конкретный вариант {attempt_n} (полный proposed_config), "
                    f"даже если стратегия уже неплохая — пользователь хочет выбрать из нескольких. Верни JSON."
                ),
            })
            continue

        try:
            prop_result = simulate_backtest(proposed, candles, include_series=False)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Backtest of proposed config attempt %d failed: %s", attempt_n, exc)
            messages.append({"role": "assistant", "content": raw})
            messages.append({"role": "user", "content": "Не удалось протестировать этот конфиг. Предложи другой вариант. Верни JSON."})
            continue

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
            "config": proposed,
        })

        # Always ask for a genuinely different next variant so the three options diverge.
        messages.append({"role": "assistant", "content": raw})
        messages.append({
            "role": "user",
            "content": (
                f"Вариант {attempt_n}: бэктест дал return={prop_return:.1f}%, drawdown={prop_drawdown:.1f}% "
                f"(оригинал: return={original_return:.1f}%, drawdown={original_drawdown:.1f}%). "
                f"Предложи ПРИНЦИПИАЛЬНО ДРУГОЙ вариант (другие индикаторы входа, уровни стопа/тейка), "
                f"чтобы пользователю было из чего выбрать. Верни JSON в том же формате."
            ),
        })

    # Never got a usable response from DeepSeek — surface the real error.
    if not final_parsed and last_error:
        raise RuntimeError(last_error)

    # Pick the best of the variants (highest return); "improved" if it beats the original.
    best_config: dict[str, Any] | None = None
    best_return: float | None = None
    best_drawdown: float | None = None
    best_n: int | None = None
    improved = False
    if attempts:
        best = max(attempts, key=lambda a: a["total_return_pct"])
        best_config = best["config"]
        best_return = best["total_return_pct"]
        best_drawdown = best["max_drawdown_pct"]
        best_n = best["n"]
        improved = best_return > original_return or (
            abs(best_return - original_return) < 1.0 and best_drawdown < original_drawdown * 0.75
        )

    rating = final_parsed.get("rating")
    return {
        "verdict": str(final_parsed.get("verdict") or ""),
        "rating": rating if rating in ("good", "mixed", "bad") else "mixed",
        "assessment": str(final_parsed.get("assessment") or ""),
        "proposed_changes": str(final_parsed.get("proposed_changes") or ""),
        "proposed_config": best_config,
        "improved": improved,
        "attempts": attempts,
        "best_n": best_n,
        "original_return_pct": original_return,
        "original_drawdown_pct": original_drawdown,
        "best_return_pct": best_return,
        "best_drawdown_pct": best_drawdown,
    }


# ---- free-form chat ("Ask AI") ---------------------------------------------

_ASK_SYSTEM = """\
Ты — ассистент по конкретному торговому боту в no-code конструкторе AlgoDesk.
Твоя единственная задача — помогать с ЭТОЙ торговой стратегией: объяснять её
поведение по бэктесту и, по запросу пользователя, предлагать изменения конфига.

Жёсткие правила (соблюдай строго):
- Отвечай ТОЛЬКО на темы этой стратегии, бота, бэктеста и торговых настроек.
  На любой посторонний вопрос вежливо откажись и предложи спросить про стратегию.
- Не выдумывай поля. Меняй только перечисленные ниже поля конфига.
- symbol и timeframe менять НЕЛЬЗЯ — оставляй как в текущем конфиге.
- Если пользователь просит что-то изменить — верни ПОЛНЫЙ новый proposed_config.
  Если он только задаёт вопрос (ничего менять не просит) — proposed_config: null.
- Все текстовые поля — на русском, коротко и по делу.

Поля конфига:
- market ("spot"|"futures"), direction ("long"|"both"), leverage (1-10)
- position_size_usdt — это МАРЖА в USD; объём позиции = маржа × leverage
- entry: массив правил (ma_cross/ema_cross/rsi/breakout/macd). ВАЖНО: движок
  использует только ПЕРВОЕ правило массива — не рассчитывай на комбинацию из нескольких.
- filters: доп. условия входа (работают реально):
  {"type":"trend","ma":"ema"|"sma","period":N} — лонг только выше MA, шорт только ниже;
  {"type":"rsi","period":N,"max":X,"min":M} — не лонговать при RSI≥max, не шортить при RSI≤min.
  Фильтр тренда/импульса клади сюда, НЕ вторым правилом в entry.
- exit: правила RSI; stop_loss/take_profit/trailing_stop: {type:"pct", value:n} (0 = выкл)
- hedge: защитный шорт (только фьючерс); daily_loss_limit_pct: дневной лимит убытка

Отвечай ТОЛЬКО валидным JSON:
{
 "answer": "ответ пользователю простым языком",
 "proposed_changes": "что изменил и почему, кратко (пусто, если без изменений)",
 "proposed_config": { ...полный конфиг той же формы... } | null
}
"""


async def ask_about_strategy(
    config: dict[str, Any],
    original_result: dict[str, Any],
    candles: list[list[float]],
    history: list[dict[str, str]],
) -> dict[str, Any]:
    """Free-form Q&A about a strategy. The model is constrained to this strategy
    and must return JSON. If it proposes a config change, it's validated and
    backtested on the same candles so the user sees the effect before saving."""
    if not is_configured():
        raise RuntimeError("AI analysis is not configured")
    from app.services.backtest import simulate_backtest  # local import avoids circular dependency

    orig_return = round(float(original_result.get("total_return_pct", 0.0)), 2)
    orig_drawdown = round(float(original_result.get("max_drawdown_pct", 0.0)), 2)
    context = {
        "config": config,
        "leverage": leverage(config),
        "backtest": {
            "total_return_pct": orig_return,
            "max_drawdown_pct": orig_drawdown,
            "win_rate_pct": round(float(original_result.get("win_rate", 0.0)), 2),
            "candles": original_result.get("candles"),
        },
        "trades": _trade_summary(original_result),
    }
    messages: list[dict[str, str]] = [
        {"role": "system", "content": _ASK_SYSTEM},
        {"role": "system", "content": "Текущая стратегия и её бэктест (JSON):\n" + json.dumps(context, ensure_ascii=False)},
        *history,
    ]
    raw = await _call_deepseek_raw(messages)

    out: dict[str, Any] = {
        "answer": "",
        "proposed_changes": "",
        "proposed_config": None,
        "original_return_pct": orig_return,
        "original_drawdown_pct": orig_drawdown,
        "proposed_return_pct": None,
        "proposed_drawdown_pct": None,
        "proposed_win_rate": None,
        "proposed_trades": None,
    }
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        out["answer"] = str(raw)
        return out

    out["answer"] = str(parsed.get("answer") or parsed.get("assessment") or "")
    out["proposed_changes"] = str(parsed.get("proposed_changes") or "")
    proposed = _parse_proposed(parsed, config)
    out["proposed_config"] = proposed
    if proposed:
        res = simulate_backtest(proposed, candles, include_series=False)
        out["proposed_return_pct"] = round(float(res.get("total_return_pct", 0.0)), 2)
        out["proposed_drawdown_pct"] = round(float(res.get("max_drawdown_pct", 0.0)), 2)
        out["proposed_win_rate"] = round(float(res.get("win_rate", 0.0)), 2)
        out["proposed_trades"] = len([t for t in res.get("trades", []) if isinstance(t.get("pnl_pct"), (int, float))])
    return out
