import httpx

from app.core.config import get_settings

settings = get_settings()


async def send_telegram_alert(telegram_id: int | None, text: str) -> None:
    if not settings.telegram_bot_token or telegram_id is None:
        return
    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json={"chat_id": telegram_id, "text": text})
    except Exception:  # noqa: BLE001 - alerts must never break the caller
        pass


async def send_admin_alert(text: str) -> None:
    """Ops alert to the configured admin chat (engine health, recovery failures).
    No-op when admin_telegram_id isn't set."""
    if not settings.admin_telegram_id:
        return
    await send_telegram_alert(settings.admin_telegram_id, f"[AlgoDesk] {text}")
