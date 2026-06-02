import httpx

from app.core.config import get_settings

settings = get_settings()


async def send_telegram_alert(telegram_id: int, text: str) -> None:
    if not settings.telegram_bot_token:
        return
    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
    async with httpx.AsyncClient(timeout=10) as client:
        await client.post(url, json={"chat_id": telegram_id, "text": text})
