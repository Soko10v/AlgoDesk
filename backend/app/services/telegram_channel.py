import json
import logging
import time
from typing import Any

import httpx

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

# Same persistent volume candle_store uses (mounted at /data in prod) — a plain
# timestamp file survives redeploys, which an in-memory guard wouldn't: without
# it, every backend restart would re-run discovery immediately and repost.
STATE_PATH = "/data/telegram_channel_state.json"
POST_INTERVAL_SEC = 2 * 24 * 3600.0  # don't post more often than the board itself refreshes


def _last_posted_at() -> float:
    try:
        with open(STATE_PATH) as f:
            return float(json.load(f).get("last_posted_at", 0.0))
    except (OSError, ValueError, json.JSONDecodeError):
        return 0.0


def _mark_posted() -> None:
    try:
        with open(STATE_PATH, "w") as f:
            json.dump({"last_posted_at": time.time()}, f)
    except OSError:
        logger.exception("telegram channel: failed to persist post state")


def _format_post(rows: list[dict[str, Any]]) -> str:
    lines = [
        "🏆 <b>Лучшие стратегии за последние дни</b>",
        "Сервер сам перебирает варианты входа и фильтров на реальных данных — вот что сейчас в топе:",
        "",
    ]
    for row in rows[:5]:
        symbol = str(row["symbol"]).replace("/USDT", "")
        lines.append(
            f"• <b>{row['title']}</b> — {symbol} {row['timeframe']}\n"
            f"  {row['total_return_pct']:+.1f}% за {row['period_days']} дн. · "
            f"просадка {row['max_drawdown_pct']:.1f}% · винрейт {row['win_rate']:.0f}%"
        )
    lines.append("")
    lines.append("Доходность посчитана на истории — не обещание будущей прибыли.")
    lines.append("Смотри и запускай бесплатно → https://algodesk.pro")
    return "\n".join(lines)


async def maybe_post_discovery(rows: list[dict[str, Any]]) -> None:
    """Post the refreshed "best strategies" board to the public channel.
    Throttled to once per refresh cycle so a mid-cycle backend restart can't
    spam it — a redeploy re-runs discovery immediately but this stays quiet
    until POST_INTERVAL_SEC has actually elapsed since the last real post."""
    if not settings.telegram_channel_bot_token or not settings.telegram_channel_id or not rows:
        return
    if time.time() - _last_posted_at() < POST_INTERVAL_SEC:
        return

    url = f"https://api.telegram.org/bot{settings.telegram_channel_bot_token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                url,
                json={
                    "chat_id": settings.telegram_channel_id,
                    "text": _format_post(rows),
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True,
                },
            )
            resp.raise_for_status()
        _mark_posted()
    except Exception:  # noqa: BLE001 - posting must never break the discovery loop
        logger.exception("telegram channel: post failed")
